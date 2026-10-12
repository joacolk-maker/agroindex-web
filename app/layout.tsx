import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://joacolk-maker.github.io/campo-claro-odepa/'),
  title: 'AgroIndex | Más información. Mejor decisión.',
  description: 'Información mayorista clara y comparable de frutas y hortalizas en Chile.',
  openGraph: {
    title: 'AgroIndex | Más información. Mejor decisión.',
    description: 'Información mayorista clara y comparable de frutas y hortalizas en Chile.',
    images: [{ url: '/og.png', width: 1672, height: 941, alt: 'AgroIndex: más información, mejores decisiones.' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AgroIndex | Más información. Mejor decisión.',
    description: 'Información mayorista clara y comparable de frutas y hortalizas en Chile.',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body>{children}</body></html>;
}
