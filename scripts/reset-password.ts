import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

// Carga manual de .env (sin depender de dotenv)
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "..", ".env");
const envContent = readFileSync(envPath, "utf-8");
for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx === -1) continue;
  const key = trimmed.slice(0, eqIdx);
  const val = trimmed.slice(eqIdx + 1).replace(/^["']|["']$/g, "");
  if (!process.env[key]) process.env[key] = val;
}

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function resetByEmail(email: string, newPassword: string) {
  const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 10 });

  if (error) throw error;

  const user = data.users.find((u) => u.email === email);
  if (!user) {
    console.error(`Usuario con email "${email}" no encontrado`);
    process.exit(1);
  }

  return resetById(user.id, newPassword);
}

async function resetById(userId: string, newPassword: string) {
  const { data, error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    password: newPassword,
  });

  if (error) throw error;

  console.log(`✅ Contraseña actualizada para usuario: ${data.user.email} (${data.user.id})`);
  return data;
}

// Usage: npx tsx scripts/reset-password.ts email usuario@example.com nuevaPassword
//    or: npx tsx scripts/reset-password.ts id <user-uuid> nuevaPassword

async function main() {
  const [mode, identifier, newPassword] = process.argv.slice(2);

  if (!mode || !identifier || !newPassword) {
    console.log("Uso:");
    console.log("  npx tsx scripts/reset-password.ts email <email> <contraseña>");
    console.log("  npx tsx scripts/reset-password.ts id    <uuid>  <contraseña>");
    process.exit(1);
  }

  if (newPassword.length < 6) {
    console.error("La contraseña debe tener al menos 6 caracteres");
    process.exit(1);
  }

  if (mode === "email") {
    await resetByEmail(identifier, newPassword);
  } else if (mode === "id") {
    await resetById(identifier, newPassword);
  } else {
    console.error('Modo debe ser "email" o "id"');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
