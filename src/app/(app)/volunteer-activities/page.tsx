import type { Metadata } from "next";
import { IconCalendarEvent, IconMapPin, IconUsers } from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { prisma } from "@/lib/db/prisma";
import { formatIST } from "@/lib/format/date";
import { NewActivityButton } from "./NewActivityButton";

export const metadata: Metadata = { title: "Volunteer activities — Rakshana" };

export default async function VolunteerActivitiesPage() {
  const activities = await prisma.volunteerActivity.findMany({
    orderBy: { startsAt: "desc" },
    include: { _count: { select: { assignments: true } } },
  });

  const now = new Date();
  const upcoming = activities.filter((a) => a.startsAt >= now);
  const past = activities.filter((a) => a.startsAt < now);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">
            Programmes
          </p>
          <h1
            className="mt-1 font-display text-3xl text-ink"
            style={{ fontVariationSettings: "'opsz' 28" }}
          >
            Volunteer activities
          </h1>
          <p className="text-sm text-ink-muted">
            {activities.length} total · {upcoming.length} upcoming. Assign
            volunteers from their profile page once an activity is created.
          </p>
        </div>
        <NewActivityButton />
      </header>

      {activities.length === 0 ? (
        <Card>
          <CardContent className="space-y-3 p-10 text-center">
            <IconCalendarEvent className="mx-auto h-8 w-8 text-ink-subtle" />
            <p className="font-display text-xl text-ink">No activities yet.</p>
            <p className="mx-auto max-w-md text-sm text-ink-muted">
              Activities are events your volunteers attend — health camps,
              tree planting drives, tutoring sessions. Create one to start
              recording check-ins and hours.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {upcoming.length > 0 && (
            <Card>
              <CardContent className="p-0">
                <header className="px-5 pt-5 pb-2">
                  <h2 className="font-display text-lg text-ink">Upcoming</h2>
                </header>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Activity</TableHead>
                      <TableHead>When</TableHead>
                      <TableHead>Where</TableHead>
                      <TableHead className="text-center">
                        Volunteers
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {upcoming.map((a) => (
                      <ActivityRow key={a.id} activity={a} />
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {past.length > 0 && (
            <Card>
              <CardContent className="p-0">
                <header className="px-5 pt-5 pb-2">
                  <h2 className="font-display text-lg text-ink">Past</h2>
                </header>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Activity</TableHead>
                      <TableHead>When</TableHead>
                      <TableHead>Where</TableHead>
                      <TableHead className="text-center">
                        Volunteers
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {past.map((a) => (
                      <ActivityRow key={a.id} activity={a} />
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function ActivityRow({
  activity,
}: {
  activity: {
    id: string;
    name: string;
    description: string | null;
    location: string | null;
    startsAt: Date;
    endsAt: Date | null;
    requiredVolunteers: number;
    _count: { assignments: number };
  };
}) {
  const filled = activity._count.assignments >= activity.requiredVolunteers;
  return (
    <TableRow>
      <TableCell>
        <div className="font-medium">{activity.name}</div>
        {activity.description ? (
          <div className="mt-0.5 text-xs text-ink-muted line-clamp-1">
            {activity.description}
          </div>
        ) : null}
      </TableCell>
      <TableCell className="text-sm">
        <div>{formatIST(activity.startsAt, "dd MMM yyyy")}</div>
        <div className="text-xs text-ink-subtle">
          {formatIST(activity.startsAt, "HH:mm")}
          {activity.endsAt ? ` – ${formatIST(activity.endsAt, "HH:mm")}` : ""}
        </div>
      </TableCell>
      <TableCell className="text-sm text-ink-muted">
        {activity.location ? (
          <span className="inline-flex items-center gap-1">
            <IconMapPin className="h-3 w-3" />
            {activity.location}
          </span>
        ) : (
          "—"
        )}
      </TableCell>
      <TableCell className="text-center">
        <Badge variant={filled ? "default" : "outline"} className="text-[10px]">
          <IconUsers className="h-3 w-3" />
          {activity._count.assignments} / {activity.requiredVolunteers}
        </Badge>
      </TableCell>
    </TableRow>
  );
}
