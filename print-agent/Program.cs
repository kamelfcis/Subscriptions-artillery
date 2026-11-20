// Windows printer bridge. Default bind is all interfaces (http://+:5678/) so LAN clients
// can reach the agent on the print-server IP. Auth remains PRINT_AGENT_KEY (X-Print-Key).
// Spool tests use Microsoft Print to PDF. A physical Datacard driver is not assumed.
using System;
using System.Drawing;
using System.Drawing.Printing;
using System.IO;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

string token = Environment.GetEnvironmentVariable("PRINT_AGENT_KEY") ?? "";
string allowOrigins = Environment.GetEnvironmentVariable("PRINT_AGENT_ORIGINS")
  ?? "http://localhost:5173,http://127.0.0.1:5173";
// Host: "+" or "0.0.0.0" => all interfaces; or a specific LAN IP; or 127.0.0.1 for loopback-only.
string bindHost = (Environment.GetEnvironmentVariable("PRINT_AGENT_HOST") ?? "+").Trim();
string bindPort = (Environment.GetEnvironmentVariable("PRINT_AGENT_PORT") ?? "5678").Trim();
if (string.Equals(bindHost, "0.0.0.0", StringComparison.OrdinalIgnoreCase) ||
    string.Equals(bindHost, "*", StringComparison.OrdinalIgnoreCase) ||
    string.IsNullOrWhiteSpace(bindHost))
  bindHost = "+";

var origins = allowOrigins.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
if (token.Length < 32) { Console.Error.WriteLine("PRINT_AGENT_KEY must contain at least 32 characters"); return; }
if (!int.TryParse(bindPort, out var port) || port < 1 || port > 65535)
{ Console.Error.WriteLine("PRINT_AGENT_PORT must be 1-65535"); return; }

string prefix = $"http://{bindHost}:{port}/";
var listener = new HttpListener();
listener.Prefixes.Add(prefix);
try { listener.Start(); }
catch (HttpListenerException ex)
{
  Console.Error.WriteLine(ex.Message);
  Console.Error.WriteLine($"Configure URL ACL, e.g.: netsh http add urlacl url={prefix} user=Everyone");
  Console.Error.WriteLine("Or run Start-PrintAgent.ps1 which registers the ACL when elevated.");
  return;
}
Console.WriteLine($"Print Agent listening on {prefix} (PRINT_AGENT_HOST={bindHost}). Default spool target is Microsoft Print to PDF. Status stays SPOOLED.");
Console.WriteLine("Auth: X-Print-Key header must match PRINT_AGENT_KEY.");
var printGate = new SemaphoreSlim(1, 1);
while (true) { var ctx = await listener.GetContextAsync(); _ = Task.Run(() => Handle(ctx)); }

async Task Handle(HttpListenerContext cx)
{
  var req = cx.Request; var res = cx.Response;
  try
  {
    string origin = req.Headers["Origin"] ?? "";
    if (!string.IsNullOrEmpty(origin) && !Array.Exists(origins, x => string.Equals(x, origin, StringComparison.OrdinalIgnoreCase)))
    { await Reply(403, "{\"error\":\"ORIGIN_FORBIDDEN\"}"); return; }
    if (!string.IsNullOrEmpty(origin))
    { res.Headers.Add("Access-Control-Allow-Origin", origin); res.Headers.Add("Vary", "Origin"); }
    res.Headers.Add("Access-Control-Allow-Headers", "Content-Type, X-Print-Key");
    res.Headers.Add("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.Headers.Add("Access-Control-Allow-Private-Network", "true");
    res.Headers.Add("Cache-Control", "no-store");
    if (req.HttpMethod == "OPTIONS") { await Reply(204, ""); return; }
    if (req.Headers["X-Print-Key"] != token) { await Reply(401, "{\"error\":\"BAD_KEY\"}"); return; }
    if (req.HttpMethod == "GET" && req.Url?.AbsolutePath == "/printers")
    {
      var arr = new List<string>();
      foreach (string s in PrinterSettings.InstalledPrinters) arr.Add(s);
      await Reply(200, JsonSerializer.Serialize(new { printers = arr })); return;
    }
    if (req.HttpMethod == "POST" && req.Url?.AbsolutePath == "/print")
    {
      if (req.ContentLength64 > 24_000_000) { await Reply(413, "{\"error\":\"TOO_LARGE\"}"); return; }
      using var reader = new StreamReader(req.InputStream, Encoding.UTF8, leaveOpen: true);
      var body = await reader.ReadToEndAsync();
      if (body.Length > 24_000_000) { await Reply(413, "{\"error\":\"TOO_LARGE\"}"); return; }
      using var j = JsonDocument.Parse(body);
      bool duplexFlag = j.RootElement.TryGetProperty("duplex", out var duplexProp) && duplexProp.ValueKind == JsonValueKind.True;
      string backBase64 = j.RootElement.TryGetProperty("backImageBase64", out var backProp) ? backProp.GetString() ?? "" : "";
      if (duplexFlag && string.IsNullOrWhiteSpace(backBase64))
      { await Reply(400, "{\"error\":\"DUPLEX_UNSUPPORTED\",\"message\":\"duplex requires backImageBase64\"}"); return; }
      var printer = j.RootElement.GetProperty("printer").GetString() ?? "";
      var base64 = j.RootElement.GetProperty("imageBase64").GetString() ?? "";
      bool exists = false;
      foreach (string p in PrinterSettings.InstalledPrinters)
        if (string.Equals(p, printer, StringComparison.OrdinalIgnoreCase)) exists = true;
      if (!exists) { await Reply(400, "{\"error\":\"PRINTER_NOT_INSTALLED\"}"); return; }
      byte[] bytes;
      try { bytes = Convert.FromBase64String(base64); }
      catch { await Reply(400, "{\"error\":\"BAD_IMAGE\"}"); return; }
      if (bytes.Length > 6_000_000 || bytes.Length < 100 || bytes[0] != 137 || bytes[1] != 80 || bytes[2] != 78 || bytes[3] != 71)
      { await Reply(400, "{\"error\":\"PNG_REQUIRED\"}"); return; }
      byte[]? backBytes = null;
      if (!string.IsNullOrWhiteSpace(backBase64))
      {
        try { backBytes = Convert.FromBase64String(backBase64); }
        catch { await Reply(400, "{\"error\":\"BAD_BACK_IMAGE\"}"); return; }
        if (backBytes.Length > 6_000_000 || backBytes.Length < 100 || backBytes[0] != 137 || backBytes[1] != 80 || backBytes[2] != 78 || backBytes[3] != 71)
        { await Reply(400, "{\"error\":\"BACK_PNG_REQUIRED\"}"); return; }
      }
      if (!await printGate.WaitAsync(10000)) { await Reply(503, "{\"error\":\"PRINTER_BUSY\"}"); return; }
      try
      {
        Exception? failure = null;
        using var finished = new ManualResetEventSlim(false);
        var thread = new Thread(() => { try { PrintPng(printer, bytes, backBytes); } catch (Exception ex) { failure = ex; } finally { finished.Set(); } });
        thread.SetApartmentState(ApartmentState.STA);
        thread.IsBackground = true;
        thread.Start();
        if (!finished.Wait(TimeSpan.FromSeconds(90))) { await Reply(503, "{\"error\":\"PRINT_SPOOL_TIMEOUT\"}"); return; }
        if (failure != null) { await Reply(500, JsonSerializer.Serialize(new { error = "PRINT_FAILED", message = failure.Message })); return; }
        var note = backBytes != null
          ? "Two pages spooled (front then back); physical duplex not confirmed"
          : "PrintDocument returned, physical card output not confirmed";
        await Reply(200, JsonSerializer.Serialize(new { status = "SPOOLED", pages = backBytes != null ? 2 : 1, note })); return;
      }
      finally { printGate.Release(); }
    }
    await Reply(404, "{\"error\":\"NOT_FOUND\"}");
  }
  catch (Exception e)
  {
    try { await Reply(500, JsonSerializer.Serialize(new { error = "AGENT_ERROR", message = e.Message })); }
    catch { }
  }
  async Task Reply(int status, string json)
  {
    res.StatusCode = status;
    if (status != 204)
    {
      res.ContentType = "application/json; charset=utf-8";
      var bytes = Encoding.UTF8.GetBytes(json);
      res.ContentLength64 = bytes.Length;
      await res.OutputStream.WriteAsync(bytes);
    }
    res.Close();
  }
}

static void PrintPng(string printer, byte[] data, byte[]? backData)
{
  using var ms = new MemoryStream(data);
  using var image = Image.FromStream(ms);
  Image? backImage = null;
  MemoryStream? backMs = null;
  if (backData != null) { backMs = new MemoryStream(backData); backImage = Image.FromStream(backMs); }
  using var job = new PrintDocument();
  job.PrinterSettings.PrinterName = printer;
  if (!job.PrinterSettings.IsValid) throw new InvalidOperationException("Invalid printer settings");
  job.DocumentName = backImage != null ? "Membership Card (2 pages)" : "Membership Card";
  job.PrintController = new StandardPrintController();
  // CR80 in hundredths of an inch; test driver page mapping and orientation with physical stock.
  job.DefaultPageSettings.PaperSize = new PaperSize("CR80", 337, 213);
  job.DefaultPageSettings.Margins = new Margins(0, 0, 0, 0);
  job.DefaultPageSettings.Landscape = false;
  job.OriginAtMargins = false;
  var page = 0;
  job.PrintPage += (sender, args) =>
  {
    var g = args.Graphics ?? throw new InvalidOperationException("No printer graphics context");
    g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
    g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.HighQuality;
    if (page == 0) g.DrawImage(image, args.PageBounds);
    else if (backImage != null) g.DrawImage(backImage, args.PageBounds);
    page++;
    args.HasMorePages = backImage != null && page < 2;
  };
  job.Print();
  backImage?.Dispose();
  backMs?.Dispose();
}
