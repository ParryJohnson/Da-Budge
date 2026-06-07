export default function ContactPage() {
  return (
    <div className="min-h-screen bg-charcoal flex items-center justify-center p-6">
      <div className="rounded-xl bg-[#252525] border border-charcoal-dark p-8 max-w-sm w-full">
        <h1 className="text-xl font-semibold text-white mb-4">Contact</h1>
        <a href="mailto:your@email.com" className="text-accent hover:text-accent-light">
          your@email.com
        </a>
      </div>
    </div>
  );
}
