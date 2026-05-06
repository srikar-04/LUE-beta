import fs from 'fs/promises';
import path from 'path';

interface SeedFile {
  schoolId: string;
  documents: unknown[];
}

const personas = {
  admin: {
    school_id: 'school_001',
    user_id: 'admin_001',
    role: 'admin',
    name: 'Principal Sharma',
  },
  teacher: {
    school_id: 'school_001',
    user_id: 'teacher_001',
    role: 'teacher',
    name: 'Ms. Meera Iyer',
    teacher_id: 'teacher_001',
    class_ids: ['class_6a', 'class_7b'],
  },
  parent: {
    school_id: 'school_001',
    user_id: 'parent_001',
    role: 'parent',
    name: 'Mr. R. Sharma',
    parent_id: 'parent_001',
    student_ids: ['student_001'],
  },
  student: {
    school_id: 'school_001',
    user_id: 'student_001',
    role: 'student',
    name: 'Arjun Sharma',
    student_id: 'student_001',
    class_ids: ['class_6a'],
  },
} as const;

const testQueries = [
  'Admin token    -> "What is Arjun\'s home address?"         -> MUST return personal data',
  'Admin token    -> "What is Priya\'s fee status?"           -> MUST return financial data',
  'Teacher token  -> "What homework is due in Class 6A?"     -> MUST return homework',
  'Teacher token  -> "What homework is due in Class 8C?"     -> MUST return nothing class-specific',
  'Teacher token  -> "What notices are posted?"              -> MUST return general notices',
  'Parent token   -> "What are my child\'s outstanding fees?" -> MUST return student_001 fees',
  'Parent token   -> "What are Priya\'s fees?"                -> MUST return nothing',
  'Parent token   -> "What is the exam schedule?"            -> MUST return general notice',
  'Student token  -> "What is my math homework?"             -> MUST return homework',
  'Student token  -> "What is Priya\'s attendance?"           -> MUST return nothing',
  'Student token  -> "What are my fees?"                     -> MUST return nothing',
  'Student token  -> "When is Sports Day?"                   -> MUST return general notice',
];

function tokenFor(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64');
}

async function main(): Promise<void> {
  const baseUrl = process.env.LUE_API_BASE_URL ?? 'http://localhost:3000';
  const seedPath = path.resolve(process.cwd(), 'data', 'seed.json');
  const raw = await fs.readFile(seedPath, 'utf-8');
  const seed = JSON.parse(raw) as SeedFile;

  const response = await fetch(`${baseUrl}/api/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      schoolId: seed.schoolId,
      documents: seed.documents,
    }),
  });

  const body = await response.json() as unknown;
  console.log('Ingest response:');
  console.log(JSON.stringify(body, null, 2));

  if (!response.ok) {
    process.exitCode = 1;
    return;
  }

  console.log('\nSession tokens:');
  for (const [name, persona] of Object.entries(personas)) {
    console.log(`${name}: ${tokenFor(persona)}`);
  }

  console.log('\nRole isolation test queries:');
  for (const query of testQueries) {
    console.log(query);
  }
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : 'Unknown seed error';
  console.error(`Seed failed: ${message}`);
  process.exitCode = 1;
});
