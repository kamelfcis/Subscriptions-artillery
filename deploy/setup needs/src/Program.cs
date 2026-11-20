// Bundled server prerequisites installer for Subscriptions Enterprise.
// Self-contained win-x64. Uses winget + npm. Run as Administrator.
using System.Diagnostics;
using System.Security.Principal;

static bool IsAdmin()
{
    using var id = WindowsIdentity.GetCurrent();
    return new WindowsPrincipal(id).IsInRole(WindowsBuiltInRole.Administrator);
}

static void Pause(string msg = "اضغط Enter للخروج...")
{
    Console.WriteLine();
    Console.WriteLine(msg);
    try { Console.ReadLine(); } catch { }
}

static int Run(string file, string args, int timeoutMs = 0)
{
    Console.WriteLine($"> {file} {args}");
    var psi = new ProcessStartInfo
    {
        FileName = file,
        Arguments = args,
        UseShellExecute = false,
        RedirectStandardOutput = true,
        RedirectStandardError = true,
        CreateNoWindow = true
    };
    using var p = Process.Start(psi) ?? throw new InvalidOperationException($"Failed to start {file}");
    p.OutputDataReceived += (_, e) => { if (e.Data != null) Console.WriteLine(e.Data); };
    p.ErrorDataReceived += (_, e) => { if (e.Data != null) Console.Error.WriteLine(e.Data); };
    p.BeginOutputReadLine();
    p.BeginErrorReadLine();
    if (timeoutMs > 0)
    {
        if (!p.WaitForExit(timeoutMs))
        {
            try { p.Kill(true); } catch { }
            Console.Error.WriteLine($"Timeout: {file}");
            return -1;
        }
    }
    else p.WaitForExit();
    return p.ExitCode;
}

static string? FindOnPath(string name)
{
    var path = Environment.GetEnvironmentVariable("Path") ?? "";
    foreach (var dir in path.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
    {
        try
        {
            var exe = Path.Combine(dir, name);
            if (File.Exists(exe)) return exe;
            var cmd = Path.Combine(dir, name + ".cmd");
            if (File.Exists(cmd)) return cmd;
            var bat = Path.Combine(dir, name + ".bat");
            if (File.Exists(bat)) return bat;
            var com = Path.Combine(dir, name + ".com");
            if (File.Exists(com)) return com;
        }
        catch { }
    }
    return null;
}

static void RefreshPath()
{
    var machine = Environment.GetEnvironmentVariable("Path", EnvironmentVariableTarget.Machine) ?? "";
    var user = Environment.GetEnvironmentVariable("Path", EnvironmentVariableTarget.User) ?? "";
    Environment.SetEnvironmentVariable("Path", machine + Path.PathSeparator + user);
}

static int WingetInstall(string id)
{
    var winget = FindOnPath("winget.exe") ?? @"C:\Program Files\WindowsApps\Microsoft.DesktopAppInstaller_8wekyb3d8bbwe\winget.exe";
    if (!File.Exists(winget) && FindOnPath("winget") is null)
    {
        // Try plain winget from PATH after refresh
        RefreshPath();
        if (FindOnPath("winget.exe") is string w) winget = w;
        else if (FindOnPath("winget") is string w2) winget = w2;
        else
        {
            Console.Error.WriteLine("winget غير موجود. ثبّت App Installer من Microsoft Store ثم أعد المحاولة.");
            return 1;
        }
    }
    // Prefer winget on PATH
    var exe = FindOnPath("winget.exe") ?? FindOnPath("winget") ?? winget;
    return Run(exe,
        $"install --id {id} -e --accept-source-agreements --accept-package-agreements --disable-interactivity");
}

static string? Capture(string file, string args)
{
    try
    {
        var psi = new ProcessStartInfo
        {
            FileName = file,
            Arguments = args,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };
        using var p = Process.Start(psi);
        if (p is null) return null;
        var o = p.StandardOutput.ReadToEnd();
        p.WaitForExit(15000);
        return (o ?? "").Trim();
    }
    catch { return null; }
}

Console.OutputEncoding = System.Text.Encoding.UTF8;
Console.WriteLine("========================================");
Console.WriteLine("  Setup Needs — متطلبات منظومة الاشتراكات");
Console.WriteLine("========================================");
Console.WriteLine();

if (!IsAdmin())
{
    Console.WriteLine("يجب التشغيل كمسؤول (Run as administrator).");
    Pause();
    return 1;
}

var steps = new (string Label, Func<int> Action)[]
{
    ("Microsoft .NET SDK 8.0 (8.0.x)", () => WingetInstall("Microsoft.DotNet.SDK.8")),
    ("Node.js 20 LTS (OpenJS.NodeJS.20 — مطلوب >= 20.17.0)", () => WingetInstall("OpenJS.NodeJS.20")),
    ("ODBC Driver 17 for SQL Server", () => WingetInstall("Microsoft.msodbcsql.17")),
    ("ODBC Driver 18 for SQL Server (اختياري/مفضّل)", () => WingetInstall("Microsoft.msodbcsql.18")),
    ("sqlcmd (Microsoft.Sqlcmd)", () => WingetInstall("Microsoft.Sqlcmd")),
};

var results = new List<(string Label, bool Ok, string Detail)>();

foreach (var (label, action) in steps)
{
    Console.WriteLine();
    Console.WriteLine($"--- تثبيت: {label} ---");
    int code;
    try { code = action(); }
    catch (Exception ex)
    {
        Console.Error.WriteLine(ex.Message);
        code = 1;
    }
    // winget often returns non-zero if already installed; treat as soft success if tool appears later
    results.Add((label, code == 0, $"exit={code}"));
    RefreshPath();
}

Console.WriteLine();
Console.WriteLine("--- تثبيت PM2 عالمياً عبر npm ---");
RefreshPath();
var npm = FindOnPath("npm.cmd") ?? FindOnPath("npm") ?? FindOnPath("npm.exe");
var node = FindOnPath("node.exe") ?? FindOnPath("node");
if (npm is null || node is null)
{
    Console.Error.WriteLine("Node/npm غير متاحين بعد التثبيت. أغلق النافذة وافتح cmd جديد كمسؤول ثم أعد تشغيل SetupNeeds.exe");
    results.Add(("PM2 (أحدث عبر npm)", false, "npm not on PATH yet"));
}
else
{
    var pm2Code = Run(npm, "install -g pm2@5");
    results.Add(("PM2 5.x (npm install -g pm2@5)", pm2Code == 0, $"exit={pm2Code}"));
}

RefreshPath();
Console.WriteLine();
Console.WriteLine("======== ملخص الإصدارات ========");
void Show(string name, string? ver) =>
    Console.WriteLine(string.IsNullOrWhiteSpace(ver) ? $"{name}: غير موجود" : $"{name}: {ver}");

Show("dotnet", Capture("dotnet", "--version") ?? Capture(@"C:\Program Files\dotnet\dotnet.exe", "--version"));
Show("node", Capture(FindOnPath("node.exe") ?? "node", "--version"));
Show("npm", Capture(FindOnPath("npm.cmd") ?? "npm", "--version"));
Show("pm2", Capture(FindOnPath("pm2.cmd") ?? FindOnPath("pm2") ?? "pm2", "--version"));
Show("sqlcmd", Capture(FindOnPath("sqlcmd.exe") ?? "sqlcmd", "-?"));

Console.WriteLine();
Console.WriteLine("نتائج الخطوات:");
foreach (var r in results)
    Console.WriteLine($"  {(r.Ok ? "[OK]" : "[!!]")} {r.Label} ({r.Detail})");

Console.WriteLine();
Console.WriteLine("بعد النجاح: افتح deploy\\README.md واتبع الخطوات 1→7.");
Console.WriteLine("ملاحظة: التشغيل المستمر في هذا المشروع يتم عبر Install-WindowsServices.bat (مهام ويندوز).");
Console.WriteLine("PM2 اختياري إن رغبت بإدارة Node يدوياً.");
Pause();
return results.Exists(r => !r.Ok) ? 2 : 0;
