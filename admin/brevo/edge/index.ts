import { createBrevoWorker } from '../worker.mjs';

// Deploy outside the public GitHub Pages tree. Never paste real values here.
const env = (name: string): string => Deno.env.get(name) ?? '';
const handler = createBrevoWorker({
  apiKey: env('BREVO_API_KEY'),
  ownListId: Number(env('BREVO_OWN_LIST_ID')),
  partnerListId: Number(env('BREVO_PARTNER_LIST_ID')),
  supabaseUrl: env('SUPABASE_URL'),
  serviceRoleKey: env('SUPABASE_SERVICE_ROLE_KEY'),
  workerToken: env('BREVO_WORKER_TOKEN'),
  webhookToken: env('BREVO_WEBHOOK_TOKEN'),
});

Deno.serve(handler);
