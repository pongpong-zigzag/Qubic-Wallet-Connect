import WalletDashboard from "@/components/wallet/WalletDashboard";

export default function Home() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <main className="mx-auto max-w-6xl px-6 py-12 lg:py-16">
        <WalletDashboard />
      </main>
    </div>
  );
}
