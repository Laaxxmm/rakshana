"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  IconSearch,
  IconHeartHandshake,
  IconReceiptRupee,
  IconFolders,
  IconSettings,
} from "@tabler/icons-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";

type Item = {
  label: string;
  href: string;
  group: string;
  icon: React.ComponentType<{ size?: number }>;
};

const ITEMS: Item[] = [
  { label: "Dashboard", href: "/", group: "Navigate", icon: IconSearch },
  { label: "All donors", href: "/donors", group: "Navigate", icon: IconHeartHandshake },
  { label: "Record a donation", href: "/donations/new", group: "Actions", icon: IconReceiptRupee },
  { label: "All projects", href: "/projects", group: "Navigate", icon: IconFolders },
  { label: "Organisation profile", href: "/settings/organisation", group: "Settings", icon: IconSettings },
  { label: "Design system", href: "/design-system", group: "Internal", icon: IconSearch },
];

export function CommandPalette() {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const groups = React.useMemo(() => {
    return ITEMS.reduce<Record<string, Item[]>>((acc, item) => {
      (acc[item.group] ||= []).push(item);
      return acc;
    }, {});
  }, []);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-ink-muted hover:bg-surface-sunken w-72"
      >
        <IconSearch size={14} />
        <span>Search Rakshana…</span>
        <kbd className="ml-auto rounded border border-border bg-canvas px-1.5 py-0.5 text-[10px] font-mono">
          ⌘K
        </kbd>
      </button>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Search donors, donations, projects…" />
        <CommandList>
          <CommandEmpty>No results.</CommandEmpty>
          {Object.entries(groups).map(([group, items], idx) => (
            <React.Fragment key={group}>
              {idx > 0 ? <CommandSeparator /> : null}
              <CommandGroup heading={group}>
                {items.map((item) => (
                  <CommandItem
                    key={item.href}
                    value={`${group} ${item.label}`}
                    onSelect={() => go(item.href)}
                  >
                    <item.icon size={14} />
                    <span>{item.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </React.Fragment>
          ))}
        </CommandList>
      </CommandDialog>
    </>
  );
}
