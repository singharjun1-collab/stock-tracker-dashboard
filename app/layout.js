export const metadata = {
  title: 'Social Stock Intelligence Monitor',
  description: 'Daily social stock signal scanner with performance tracking',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js" defer></script>
      </head>
      <body>{children}</body>
    </html>
  );
}
