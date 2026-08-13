"use client"

import { ChevronDown, LogOut } from "lucide-react"

import { signOut } from "@/lib/auth/actions"
import { ROLE_LABELS } from "@/lib/auth/roles"
import { initialsOf } from "@/lib/format"
import type { SessionProfile } from "@/lib/auth/session"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"


/**
 * Account menu for the back office.
 *
 * Note this shadcn style is built on Base UI, so composition uses the `render`
 * prop rather than Radix's `asChild`.
 */
export function UserMenu({ profile }: { profile: SessionProfile }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="lg" className="gap-2 px-1.5" />}
      >
        <Avatar className="size-6">
          <AvatarFallback className="bg-brand-100 text-brand-800 text-[11px] font-medium">
            {initialsOf(profile.fullName)}
          </AvatarFallback>
        </Avatar>
        <span className="hidden max-w-[12ch] truncate text-sm sm:inline">
          {profile.fullName}
        </span>
        <ChevronDown className="text-muted-foreground size-3.5" aria-hidden />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <div className="truncate text-sm font-medium">{profile.fullName}</div>
          {profile.email ? (
            <div className="text-muted-foreground truncate text-xs">
              {profile.email}
            </div>
          ) : null}
          <div className="text-brand-700 mt-1 text-xs font-medium">
            {ROLE_LABELS[profile.role]}
          </div>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        {/* A form, not an onClick — signing out is a mutation, so it posts. */}
        <form action={signOut}>
          <DropdownMenuItem
            render={<button type="submit" />}
            nativeButton
            variant="destructive"
            className="w-full"
          >
            <LogOut aria-hidden />
            Sign out
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
