export default function DesignLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      className="[&_h1]:font-[family-name:var(--app-font-display)] [&_h2]:font-[family-name:var(--app-font-display)] [&_h3]:font-[family-name:var(--app-font-display)]"
    >
      {children}
    </div>
  );
}
