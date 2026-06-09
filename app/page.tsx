import { ZeroShell } from "@/components/zero/zero-shell"

export default function Page() {
  const dateLabel = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date())

  return <ZeroShell dateLabel={dateLabel} />
}
