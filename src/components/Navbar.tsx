import Link from 'next/link';

export default function Navbar() {
  return (
    <header className="bg-slate-900 border-b border-slate-800 sticky top-0 z-50">
      <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-blue-500 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm leading-none">A</span>
          </div>
          <span className="text-white font-semibold text-base tracking-tight">Atlas</span>
        </Link>
        <nav className="flex items-center gap-1">
          <Link
            href="/"
            className="text-slate-400 hover:text-white text-sm px-3 py-1.5 rounded-lg hover:bg-slate-800 transition-colors"
          >
            Lista do dia
          </Link>
          <Link
            href="/dados"
            className="text-slate-400 hover:text-white text-sm px-3 py-1.5 rounded-lg hover:bg-slate-800 transition-colors"
          >
            Dados
          </Link>
          <Link
            href="/upload"
            className="bg-blue-600 hover:bg-blue-500 text-white text-sm px-3 py-1.5 rounded-lg font-medium transition-colors"
          >
            + Importar CSV
          </Link>
        </nav>
      </div>
    </header>
  );
}
