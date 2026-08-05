export default function MainContent({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      style={{
        // Diviso per --zoom come il min-height del body (globals.css):
        // 100vh secchi dentro il body zoomato rendono il documento più
        // alto del viewport → ~150px di scroll "nero" su ogni pagina.
        minHeight: "calc(100vh / var(--zoom, 1))",
        position: "relative",
        zIndex: 1,
      }}
    >
      {children}
    </main>
  );
}
