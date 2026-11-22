// Sets a password on an account that ALREADY EXISTS on the DEVELOPMENT project (A65).
//
//   node --env-file=.env.local scripts/dev-set-password.mjs <email> [password]
//
//   node --env-file=.env.local scripts/dev-set-password.mjs admin@example.com
//   node --env-file=.env.local scripts/dev-set-password.mjs admin@example.com "my own password"
//
// With no password given, a strong one is generated and printed once.
//
// WHY THIS EXISTS: email + password is the primary way in (A149), but an account created before
// that decision -- or by the demo tooling -- has no password its owner knows, and there is no
// "forgot password" because there is no mailer (A151). Until an SMTP provider exists, this is
// the admin-side reset that gap refers to. It is deliberately NOT a product feature and NOT a
// server action: it runs from a terminal, by someone holding the service key.
//
// WHY IT IS NOT THE SAME AS A JOIN LINK SETTING A PASSWORD: A150 forbids a bearer link from
// setting a password on an address its holder may not control, because anyone can hold a link.
// Only the project owner holds the service key, so the trust is of a different kind entirely.
//
// It never creates an account: if the address is unknown it says so and stops.
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";

const [, , emailArg, passwordArg] = process.argv;

if (!emailArg) {
  console.error("usage: node --env-file=.env.local scripts/dev-set-password.mjs <email> [password]");
  process.exit(1);
}
const email = emailArg.trim().toLowerCase();

// Matches the floor the product enforces (src/server/services/join-links.ts), so this tool can
// never leave an account weaker than registration would have.
const MIN_PASSWORD_LENGTH = 8;

const need = (k) => {
  const v = process.env[k];
  if (!v) throw new Error(`missing env ${k}`);
  return v;
};

/** Readable but not guessable: 24 chars from an unambiguous alphabet, drawn without modulo bias. */
function generatePassword() {
  const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const limit = 256 - (256 % alphabet.length);
  let out = "";
  while (out.length < 24) {
    for (const b of randomBytes(32)) {
      if (b >= limit) continue; // reject, so every character stays equally likely
      out += alphabet[b % alphabet.length];
      if (out.length === 24) break;
    }
  }
  return out;
}

const password = passwordArg ?? generatePassword();
if (password.length < MIN_PASSWORD_LENGTH) {
  console.error(`\nPassword must be at least ${MIN_PASSWORD_LENGTH} characters.\n`);
  process.exit(1);
}

const admin = createClient(need("NEXT_PUBLIC_SUPABASE_URL"), need("SUPABASE_SECRET_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** listUsers is the only lookup the admin API offers, so walk its pages. */
async function findUser(address) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const found = data.users.find((u) => u.email?.toLowerCase() === address);
    if (found) return found;
    if (data.users.length < 1000) return null;
  }
  return null;
}

const user = await findUser(email);
if (!user) {
  console.error(`\nNo account for ${email} on this project.`);
  console.error("This script sets a password on an account that already exists; it never creates one.");
  console.error("Create it the way the product does: a join link, or an invitation.\n");
  process.exit(2);
}

const { error } = await admin.auth.admin.updateUserById(user.id, { password });
if (error) throw new Error(`updateUserById: ${error.message}`);

console.log(`\n${email}`);
console.log(`  password: ${password}`);
console.log(`\nSign in at /{locale}/sign-in with these. The password does not expire.`);
console.log(`It is printed once and not stored anywhere by this script -- save it now.\n`);
