/**
 * Endpoint público que entrega la URL y ANON key de Supabase al
 * shim que corre dentro del iframe legacy (proveedores.html).
 *
 * NOTA: el ANON key está diseñado para ser público — la seguridad
 * real vive en las políticas RLS de la tabla `app_state`.
 */
export const dynamic = 'force-static';

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return new Response(
      JSON.stringify({ error: 'Supabase env vars no configuradas' }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    );
  }

  return new Response(JSON.stringify({ url, anonKey }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'public, max-age=300',
    },
  });
}
