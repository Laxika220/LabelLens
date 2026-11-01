import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-col gap-6 pt-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">LabelLens</h1>
        <p className="mt-2 text-lg text-muted">
          Photograph the ingredient list on a packaged food. LabelLens reads it, and you check
          what it found before anything is analysed.
        </p>
      </header>

      <Link href="/scan" className="btn-primary text-lg">
        Scan a label
      </Link>
      <Link href="/profile" className="btn-secondary">
        Allergies, diet and health profile
      </Link>

      <section className="card text-sm leading-relaxed">
        <h2 className="mb-1 font-bold">What to expect</h2>
        <ul className="list-disc space-y-1 pl-5 text-muted">
          <li>Photos are cropped and stripped of location data on your phone before upload.</li>
          <li>The server reads the photo and deletes it straight away.</li>
          <li>You always review and correct the ingredient list before analysis.</li>
          <li>Always check allergens on the physical label too.</li>
        </ul>
      </section>
    </div>
  );
}
