"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  IconSearch,
  IconHeartHandshake,
  IconReceiptRupee,
  IconFolders,
  IconSettings,
  IconBuildingStore,
} from "@tabler/icons-react";
import {
  Command,
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { searchEverything, type SearchGroup, type SearchHit } from "@/lib/actions/search";

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
];

const RESULT_ICON: Record<SearchGroup, React.ComponentType<{ size?: number }>> = {
  Donors: IconHeartHandshake,
  Donations: IconReceiptRupee,
  Projects: IconFolders,
  Vendors: IconBuildingStore,
};

/** Must match the minimum the `searchEverything` input schema accepts. */
const MIN_QUERY = 2;
const DEBOUNCE_MS = 200;

const NO_HITS: SearchHit[] = [];

export function CommandPalette() {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  // Results are stored with the query that produced them, so a reply that
  // arrives after the user has typed on is simply no longer current.
  const [result, setResult] = React.useState<{ q: string; hits: SearchHit[] } | null>(null);
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

  const trimmed = query.trim();

  React.useEffect(() => {
    if (trimmed.length < MIN_QUERY) return;
    // Cleanup cancels the pending keystroke and, once it has fired, drops the
    // reply on the floor.
    let live = true;
    const timer = setTimeout(async () => {
      const res = await searchEverything({ q: trimmed });
      if (live) setResult({ q: trimmed, hits: res?.data ?? [] });
    }, DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [trimmed]);

  const hits = result?.q === trimmed ? result.hits : NO_HITS;
  const searching = trimmed.length >= MIN_QUERY && result?.q !== trimmed;

  const resultGroups = React.useMemo(() => {
    const byGroup = new Map<SearchGroup, SearchHit[]>();
    for (const hit of hits) {
      const list = byGroup.get(hit.group);
      if (list) list.push(hit);
      else byGroup.set(hit.group, [hit]);
    }
    return [...byGroup];
  }, [hits]);

  // Results are filtered by Postgres; the static entries are filtered here.
  // cmdk's own fuzzy pass would drop server rows matched on a field the row
  // does not display, such as a donor found by PAN.
  const navGroups = React.useMemo(() => {
    const needle = trimmed.toLowerCase();
    return ITEMS.filter((item) => item.label.toLowerCase().includes(needle)).reduce<
      Record<string, Item[]>
    >((acc, item) => {
      (acc[item.group] ||= []).push(item);
      return acc;
    }, {});
  }, [trimmed]);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  const nothingToShow =
    resultGroups.length === 0 && Object.keys(navGroups).length === 0 && !searching;

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
      <CommandDialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) setQuery("");
        }}
      >
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search donors, receipt numbers, projects, vendors…"
          />
          <CommandList>
            {nothingToShow ? (
              <p className="py-6 text-center text-sm text-ink-muted">
                {trimmed.length < MIN_QUERY
                  ? "Type at least two characters."
                  : `Nothing matches "${trimmed}".`}
              </p>
            ) : null}

            {searching && resultGroups.length === 0 ? (
              <p className="py-6 text-center text-sm text-ink-muted">Searching…</p>
            ) : null}

            {resultGroups.map(([group, groupHits]) => {
              const Icon = RESULT_ICON[group];
              return (
                <CommandGroup key={group} heading={group}>
                  {groupHits.map((hit) => (
                    <CommandItem key={hit.key} value={hit.key} onSelect={() => go(hit.href)}>
                      <Icon size={14} />
                      <span className="truncate">{hit.label}</span>
                      <span className="ml-auto truncate pl-3 text-xs text-ink-subtle">
                        {hit.hint}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              );
            })}

            {Object.entries(navGroups).map(([group, items], idx) => (
              <React.Fragment key={group}>
                {idx > 0 || resultGroups.length > 0 ? <CommandSeparator /> : null}
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
        </Command>
      </CommandDialog>
    </>
  );
}
