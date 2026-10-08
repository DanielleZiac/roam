/*
 * One icon per need group, so tables can show the group without spelling it
 * out in every row. The group's name is still there for screen readers and
 * appears as a tooltip on hover.
 *
 * Icons are from Lucide (ISC licence), the same set the storefront theme uses.
 */
import type { ReactNode } from "react";

const ICONS: Record<string, ReactNode> = {
  Mobility: (
    <>
      <circle cx="16" cy="4" r="1" />
      <path d="m18 19 1-7-6 1" />
      <path d="m5 8 3-3 5.5 3-2.36 3.5" />
      <path d="M4.24 14.5a5 5 0 0 0 6.88 6" />
      <path d="M13.76 17.5a5 5 0 0 0-6.88-6" />
    </>
  ),
  "Hands and dexterity": (
    <>
      <path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2" />
      <path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2" />
      <path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8" />
      <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
    </>
  ),
  "Deaf and hard of hearing": (
    <>
      <path d="M6 8.5a6.5 6.5 0 1 1 13 0c0 6-6 6-6 10a3.5 3.5 0 1 1-7 0" />
      <path d="M15 8.5a2.5 2.5 0 0 0-5 0v1a2 2 0 1 1 0 4" />
    </>
  ),
  Nonspeaking: <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />,
  "Blind and low vision": (
    <>
      <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
};

// The quiz's need tags, each shown with the icon of the group it belongs to.
const TAG_GROUPS: Record<string, string> = {
  mobility: "Mobility",
  wheelchair: "Mobility",
  "walking-aid": "Mobility",
  dexterity: "Hands and dexterity",
  "deaf-hoh": "Deaf and hard of hearing",
  nonspeaking: "Nonspeaking",
  "blind-low-vision": "Blind and low vision",
};

export function NeedIcon({
  group,
  decorative = false,
}: {
  // A need group's name, or one of the quiz's need tags.
  group: string;
  // Set when the name is written out next to the icon, so screen readers do not hear it twice.
  decorative?: boolean;
}) {
  const name = TAG_GROUPS[group] ?? group;
  const icon = ICONS[name];
  // A group without an icon is shown by name, so nothing is ever left blank.
  if (!icon) return decorative ? null : <>{group}</>;

  if (decorative) {
    return (
      <svg
        viewBox="0 0 24 24"
        width="20"
        height="20"
        aria-hidden="true"
        fill="none"
        stroke="#303030"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ display: "block" }}
      >
        {icon}
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      role="img"
      aria-label={name}
      fill="none"
      stroke="#303030"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: "block" }}
    >
      <title>{name}</title>
      {icon}
    </svg>
  );
}
