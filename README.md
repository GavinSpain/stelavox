This is the Stelavox Next.js application. Full setup + spec library lives under `docs/` (start with `docs/stelavox_deployment_setup_v1_0.md` for environment setup, then the project `CLAUDE.md` for build context).

## Local development

Three processes need to be running:

```bash
# 1. Local Supabase stack (DB + Auth + Realtime + Edge Functions runtime)
supabase start

# 2. Next.js dev server
npm run dev

# 3. (BYOK only) BYOK Edge Function — required if you have a per-user
#    Anthropic API key saved at /settings/api-keys. supabase start does
#    NOT auto-serve individual Edge Functions.
supabase functions serve byok-llm-call
```

Open [http://localhost:3000](http://localhost:3000) once steps 1 + 2 are running.

If you save a BYOK key at `/settings/api-keys` and try a Director conversation **without** running step 3, you'll see a `ByokEdgeFunctionUnavailableError` with the exact `supabase functions serve` command to run. The error is self-explaining; this README is the secondary surface.

See `docs/stelavox_deployment_setup_v1_0.md` Step 6a for the full BYOK Edge Function context.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
