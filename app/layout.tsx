import type { Metadata } from 'next';
import Script from 'next/script';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://agroindex.cl/'),
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
  return (
    <html lang="es">
      <body>
        {children}
        <Script
          type="module"
          src="https://static.cloudflareinsights.com/beacon.min.js"
          data-cf-beacon='{"token":"f5e523bb78cc4e9e9eb0412506a9085f"}'
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}
