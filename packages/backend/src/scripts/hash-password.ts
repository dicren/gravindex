import * as bcrypt from 'bcrypt';

// The admin surface's first user is inserted BY HAND in the database
// (root AGENTS.md, "Settled implementation details"), which means the INSERT
// has to carry an already-hashed password — a row with a plaintext one simply
// fails to log in, silently and confusingly. This is the way to produce that
// hash:
//
//     npm run build && npm run hash-password -- 'the password'
//
// ⚠️ It prints to stdout, so it lands in the shell history of whoever runs it.
// That is acceptable for a one-off bootstrap and is not a place to store
// anything.
const SALT_ROUNDS = 10;

async function main(): Promise<void> {
  const password = process.argv[2];
  if (!password) {
    console.error("usage: npm run hash-password -- '<password>'");
    process.exitCode = 1;
    return;
  }
  console.log(await bcrypt.hash(password, SALT_ROUNDS));
}

void main();
