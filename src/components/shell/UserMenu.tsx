"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";
import { IconLogout, IconSettings } from "@tabler/icons-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export function UserMenu({
  name,
  email,
  role,
}: {
  name: string;
  email: string;
  role: string;
}) {
  const initials = name
    .split(/[\s@.]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account menu"
        className="flex items-center rounded-full focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <Avatar className="h-8 w-8">
          <AvatarFallback className="bg-primary text-primary-foreground text-xs font-medium">
            {initials || "?"}
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {/* Base UI throws "MenuGroupContext is missing" if a Label sits
            outside a Group, which took the whole app down on click. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <span className="block truncate text-sm font-medium">{name}</span>
            <span className="block truncate text-xs text-ink-muted">{email}</span>
            <span className="mt-1 block text-[10px] uppercase tracking-wider text-ink-subtle">
              {role}
            </span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {/* On a phone this menu is the only way to the settings hub, and a
            28px row is not a thumb target. */}
        <DropdownMenuItem
          className="min-h-11 md:min-h-0"
          render={
            <Link href="/settings/organisation">
              <IconSettings size={14} />
              Settings
            </Link>
          }
        />
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="min-h-11 text-destructive focus:text-destructive md:min-h-0"
        >
          <IconLogout size={14} />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
