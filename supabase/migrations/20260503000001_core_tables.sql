-- Migration 001 — Core tables
-- Source: stelavox_technical_architecture_v1_3.md §3.6 Migration 001
-- Tables: organisations, organisation_members, organisation_invites,
--         projects, layer_stacks, documents, agent_profiles

-- Organisations (billing and access-control unit)
CREATE TABLE organisations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  plan TEXT NOT NULL DEFAULT 'trial'
    CHECK (plan IN ('trial','byok_solo','byok_team','writer','author','pro')),
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  subscription_status TEXT NOT NULL DEFAULT 'trialling'
    CHECK (subscription_status IN ('active','trialling','past_due','cancelled','expired','suspended')),
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  byok_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  byok_provider TEXT CHECK (byok_provider IN ('anthropic','openai','google','mistral')),
  byok_api_key_vault_id TEXT,
  preferred_model_overrides JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Organisation members (user ↔ organisation junction)
CREATE TABLE organisation_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
  invited_by_user_id UUID REFERENCES auth.users(id),
  invited_at TIMESTAMPTZ,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organisation_id, user_id)
);

-- Organisation invites
CREATE TABLE organisation_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
  invited_by UUID NOT NULL REFERENCES auth.users(id),
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','expired','revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Projects
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  default_document_type TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Layer stacks (one per document — forked from template at creation)
CREATE TABLE layer_stacks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID,  -- null for templates; FK added in Migration 007
  organisation_id UUID REFERENCES organisations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  document_type TEXT NOT NULL,
  is_template BOOLEAN NOT NULL DEFAULT FALSE,
  layers JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Documents
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  document_type TEXT NOT NULL DEFAULT 'novel',
  layer_stack_id UUID REFERENCES layer_stacks(id),
  root_node_id UUID,  -- set after root node is created (Phase 2+)
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived','published')),
  export_settings JSONB DEFAULT '{}',
  authors TEXT[] DEFAULT '{}',
  director_config_id UUID,  -- FK added in Migration 011
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Agent profiles
CREATE TABLE agent_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID REFERENCES organisations(id) ON DELETE CASCADE,  -- null = system profile
  name TEXT NOT NULL,
  description TEXT,
  operation_class TEXT NOT NULL DEFAULT 'single_node'
    CHECK (operation_class IN ('single_node','document_operation')),
  operation_type TEXT NOT NULL,
  node_type TEXT,
  system_prompt TEXT NOT NULL,
  output_format_instructions TEXT,
  model_id TEXT NOT NULL DEFAULT 'claude-haiku-4-5-20251001',
  temperature NUMERIC NOT NULL DEFAULT 0.7,
  max_tokens INTEGER NOT NULL DEFAULT 4096,
  context_rules JSONB DEFAULT '{}',
  node_scope_definition JSONB DEFAULT '{}',
  is_system_profile BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
