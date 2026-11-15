/** Pantalla cuando falta VITE_API_URL (el panel no puede llamar a la API). */
export function ConfigProblem({ message }: { message: string }) {
  return (
    <div className="center-screen">
      <section className="card stack" role="alert">
        <h1>Falta configurar el panel</h1>
        <p>{message}</p>
      </section>
    </div>
  );
}
