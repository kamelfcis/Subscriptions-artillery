import React from 'react';
import { formatMembershipId } from '../membership-id';

/** Stored category-serial (`01-100`), isolated so RTL layout cannot reorder digits. */
export default function MembershipId({ value, className }) {
  return (
    <bdi dir="ltr" className={className}>
      {formatMembershipId(value)}
    </bdi>
  );
}
