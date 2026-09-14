import { TabSkeleton, type TabSkeletonCard } from "../tab-skeleton";

/**
 * Financials: five full-width numbered sections — Scale, Track record, Where the
 * money goes, Who does the work, Who funds them — so the skeleton is a single
 * column and every card carries the serif numeral the real ones do
 * (`SectionCard`'s `numbered`, which is what puts the figure on the title's
 * baseline rather than in front of it).
 *
 * Five, not the two the old version drew: the tab grew three sections and the
 * skeleton kept drawing two slabs, so two-thirds of the page arrived from
 * nothing.
 *
 * Approximated because it is data: how many grant, filing, funder and staff rows
 * each section holds. Each body is the shape its section uses — a row of readings
 * for Scale and Track record, a table where the section lists records.
 */
const CARDS: TabSkeletonCard[] = [
  { title: "w-24", hint: "w-80", numbered: true, kind: "stats", cells: 4 },
  { title: "w-36", hint: "w-72", numbered: true, kind: "table", rows: 5 },
  { title: "w-48", hint: "w-80", numbered: true, kind: "table", rows: 4 },
  { title: "w-40", hint: "w-64", numbered: true, kind: "stats", cells: 3 },
  { title: "w-40", hint: "w-72", numbered: true, kind: "list", rows: 5 },
];

export default function Loading() {
  return <TabSkeleton cards={CARDS} columns="single" />;
}
