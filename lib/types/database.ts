export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      agent_jobs: {
        Row: {
          actual_input_tokens: number | null
          actual_output_tokens: number | null
          batch_id: string | null
          bucket_wait_ms: number | null
          cause: string | null
          completed_at: string | null
          context_snapshot: Json | null
          cost_credits: number | null
          cost_usd: number | null
          crashed_at: string | null
          created_at: string
          dependency_wait_ms: number | null
          director_turn_id: string | null
          dispatched_at: string | null
          dispatcher_skips_count: number
          document_id: string | null
          error_message: string | null
          execution_intent: string
          failure_class: string | null
          id: string
          iteration_number: number | null
          iteration_state: Json | null
          job_progress: Json | null
          last_heartbeat_at: string | null
          model_id: string | null
          node_id: string | null
          operation_class: string
          operation_type: string
          organisation_id: string
          parent_iteration_id: string | null
          profile_id: string | null
          provider: string | null
          queue_status: string
          queued_at: string
          reservation_id: string | null
          result_child_nodes: Json | null
          result_metadata: Json | null
          result_notes: string | null
          result_prose: string | null
          result_report_id: string | null
          result_summary: string | null
          result_summary_text: string | null
          route: string
          scheduled_at: string | null
          started_at: string | null
          status: string
          target_node_version_at_capture: number | null
          tokens_cache_read: number | null
          tokens_cache_write: number | null
          tokens_input: number | null
          tokens_output: number | null
          traffic_class: number
          triggered_by: string
          wfq_vft_at_dispatch: number | null
        }
        Insert: {
          actual_input_tokens?: number | null
          actual_output_tokens?: number | null
          batch_id?: string | null
          bucket_wait_ms?: number | null
          cause?: string | null
          completed_at?: string | null
          context_snapshot?: Json | null
          cost_credits?: number | null
          cost_usd?: number | null
          crashed_at?: string | null
          created_at?: string
          dependency_wait_ms?: number | null
          director_turn_id?: string | null
          dispatched_at?: string | null
          dispatcher_skips_count?: number
          document_id?: string | null
          error_message?: string | null
          execution_intent?: string
          failure_class?: string | null
          id?: string
          iteration_number?: number | null
          iteration_state?: Json | null
          job_progress?: Json | null
          last_heartbeat_at?: string | null
          model_id?: string | null
          node_id?: string | null
          operation_class?: string
          operation_type: string
          organisation_id: string
          parent_iteration_id?: string | null
          profile_id?: string | null
          provider?: string | null
          queue_status?: string
          queued_at?: string
          reservation_id?: string | null
          result_child_nodes?: Json | null
          result_metadata?: Json | null
          result_notes?: string | null
          result_prose?: string | null
          result_report_id?: string | null
          result_summary?: string | null
          result_summary_text?: string | null
          route?: string
          scheduled_at?: string | null
          started_at?: string | null
          status?: string
          target_node_version_at_capture?: number | null
          tokens_cache_read?: number | null
          tokens_cache_write?: number | null
          tokens_input?: number | null
          tokens_output?: number | null
          traffic_class?: number
          triggered_by: string
          wfq_vft_at_dispatch?: number | null
        }
        Update: {
          actual_input_tokens?: number | null
          actual_output_tokens?: number | null
          batch_id?: string | null
          bucket_wait_ms?: number | null
          cause?: string | null
          completed_at?: string | null
          context_snapshot?: Json | null
          cost_credits?: number | null
          cost_usd?: number | null
          crashed_at?: string | null
          created_at?: string
          dependency_wait_ms?: number | null
          director_turn_id?: string | null
          dispatched_at?: string | null
          dispatcher_skips_count?: number
          document_id?: string | null
          error_message?: string | null
          execution_intent?: string
          failure_class?: string | null
          id?: string
          iteration_number?: number | null
          iteration_state?: Json | null
          job_progress?: Json | null
          last_heartbeat_at?: string | null
          model_id?: string | null
          node_id?: string | null
          operation_class?: string
          operation_type?: string
          organisation_id?: string
          parent_iteration_id?: string | null
          profile_id?: string | null
          provider?: string | null
          queue_status?: string
          queued_at?: string
          reservation_id?: string | null
          result_child_nodes?: Json | null
          result_metadata?: Json | null
          result_notes?: string | null
          result_prose?: string | null
          result_report_id?: string | null
          result_summary?: string | null
          result_summary_text?: string | null
          route?: string
          scheduled_at?: string | null
          started_at?: string | null
          status?: string
          target_node_version_at_capture?: number | null
          tokens_cache_read?: number | null
          tokens_cache_write?: number | null
          tokens_input?: number | null
          tokens_output?: number | null
          traffic_class?: number
          triggered_by?: string
          wfq_vft_at_dispatch?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_jobs_director_turn_id_fkey"
            columns: ["director_turn_id"]
            isOneToOne: false
            referencedRelation: "director_turns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_jobs_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_jobs_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_jobs_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "nodes_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_jobs_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_jobs_parent_iteration_id_fkey"
            columns: ["parent_iteration_id"]
            isOneToOne: false
            referencedRelation: "agent_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_jobs_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "agent_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_jobs_reservation_id_fk"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "throttle_reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_profiles: {
        Row: {
          context_rules: Json | null
          created_at: string
          description: string | null
          id: string
          is_system_profile: boolean
          max_tokens: number
          model_id: string
          name: string
          node_scope_definition: Json | null
          node_type: string | null
          operation_class: string
          operation_type: string
          organisation_id: string | null
          output_format_instructions: string | null
          system_prompt: string
          temperature: number
          updated_at: string
        }
        Insert: {
          context_rules?: Json | null
          created_at?: string
          description?: string | null
          id?: string
          is_system_profile?: boolean
          max_tokens?: number
          model_id?: string
          name: string
          node_scope_definition?: Json | null
          node_type?: string | null
          operation_class?: string
          operation_type: string
          organisation_id?: string | null
          output_format_instructions?: string | null
          system_prompt: string
          temperature?: number
          updated_at?: string
        }
        Update: {
          context_rules?: Json | null
          created_at?: string
          description?: string | null
          id?: string
          is_system_profile?: boolean
          max_tokens?: number
          model_id?: string
          name?: string
          node_scope_definition?: Json | null
          node_type?: string | null
          operation_class?: string
          operation_type?: string
          organisation_id?: string | null
          output_format_instructions?: string | null
          system_prompt?: string
          temperature?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_profiles_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_reports: {
        Row: {
          agent_job_id: string | null
          created_at: string
          document_id: string
          findings: Json
          id: string
          operation_type: string
          organisation_id: string
          profile_id: string | null
          read_at: string | null
          status: string
          summary: string | null
          title: string
        }
        Insert: {
          agent_job_id?: string | null
          created_at?: string
          document_id: string
          findings?: Json
          id?: string
          operation_type: string
          organisation_id: string
          profile_id?: string | null
          read_at?: string | null
          status?: string
          summary?: string | null
          title: string
        }
        Update: {
          agent_job_id?: string | null
          created_at?: string
          document_id?: string
          findings?: Json
          id?: string
          operation_type?: string
          organisation_id?: string
          profile_id?: string | null
          read_at?: string | null
          status?: string
          summary?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_reports_agent_job_id_fkey"
            columns: ["agent_job_id"]
            isOneToOne: false
            referencedRelation: "agent_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_reports_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_reports_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_reports_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "agent_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          conversation_id: string | null
          created_at: string
          document_id: string | null
          event_type: string
          id: string
          metadata: Json | null
          node_id: string | null
          organisation_id: string | null
          severity: string
          user_id: string | null
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string
          document_id?: string | null
          event_type: string
          id?: string
          metadata?: Json | null
          node_id?: string | null
          organisation_id?: string | null
          severity?: string
          user_id?: string | null
        }
        Update: {
          conversation_id?: string | null
          created_at?: string
          document_id?: string | null
          event_type?: string
          id?: string
          metadata?: Json | null
          node_id?: string | null
          organisation_id?: string | null
          severity?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      backup_configs: {
        Row: {
          access_token_vault_id: string
          created_at: string
          enabled: boolean
          folder_path: string
          formats: string[]
          id: string
          include_version_history: boolean
          last_backup_at: string | null
          organisation_id: string
          provider: string
          refresh_token_vault_id: string
          schedule: string
          schedule_day_of_week: number | null
          schedule_hour_utc: number | null
          updated_at: string
        }
        Insert: {
          access_token_vault_id: string
          created_at?: string
          enabled?: boolean
          folder_path?: string
          formats?: string[]
          id?: string
          include_version_history?: boolean
          last_backup_at?: string | null
          organisation_id: string
          provider: string
          refresh_token_vault_id: string
          schedule?: string
          schedule_day_of_week?: number | null
          schedule_hour_utc?: number | null
          updated_at?: string
        }
        Update: {
          access_token_vault_id?: string
          created_at?: string
          enabled?: boolean
          folder_path?: string
          formats?: string[]
          id?: string
          include_version_history?: boolean
          last_backup_at?: string | null
          organisation_id?: string
          provider?: string
          refresh_token_vault_id?: string
          schedule?: string
          schedule_day_of_week?: number | null
          schedule_hour_utc?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "backup_configs_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      backup_jobs: {
        Row: {
          completed_at: string | null
          config_id: string
          document_count: number | null
          error_message: string | null
          file_size_bytes: number | null
          id: string
          node_count: number | null
          organisation_id: string
          provider_file_id: string | null
          provider_file_url: string | null
          started_at: string
          status: string
          trigger: string
        }
        Insert: {
          completed_at?: string | null
          config_id: string
          document_count?: number | null
          error_message?: string | null
          file_size_bytes?: number | null
          id?: string
          node_count?: number | null
          organisation_id: string
          provider_file_id?: string | null
          provider_file_url?: string | null
          started_at?: string
          status?: string
          trigger: string
        }
        Update: {
          completed_at?: string | null
          config_id?: string
          document_count?: number | null
          error_message?: string | null
          file_size_bytes?: number | null
          id?: string
          node_count?: number | null
          organisation_id?: string
          provider_file_id?: string | null
          provider_file_url?: string | null
          started_at?: string
          status?: string
          trigger?: string
        }
        Relationships: [
          {
            foreignKeyName: "backup_jobs_config_id_fkey"
            columns: ["config_id"]
            isOneToOne: false
            referencedRelation: "backup_configs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "backup_jobs_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      brief_stages: {
        Row: {
          brief_id: string
          completed_at: string | null
          created_at: string
          description: string | null
          id: string
          order: number
          started_at: string | null
          status: string
          title: string
          trigger_config: Json
          trigger_type: string
          workflow_id: string | null
        }
        Insert: {
          brief_id: string
          completed_at?: string | null
          created_at?: string
          description?: string | null
          id?: string
          order: number
          started_at?: string | null
          status?: string
          title: string
          trigger_config?: Json
          trigger_type: string
          workflow_id?: string | null
        }
        Update: {
          brief_id?: string
          completed_at?: string | null
          created_at?: string
          description?: string | null
          id?: string
          order?: number
          started_at?: string | null
          status?: string
          title?: string
          trigger_config?: Json
          trigger_type?: string
          workflow_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "brief_stages_brief_id_fkey"
            columns: ["brief_id"]
            isOneToOne: false
            referencedRelation: "briefs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brief_stages_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      briefs: {
        Row: {
          approved_at: string | null
          cancelled_at: string | null
          cause: string
          completed_at: string | null
          created_at: string
          current_stage_id: string | null
          document_id: string
          goal_text: string
          id: string
          organisation_id: string
          sequence_position: number
          started_at: string | null
          status: string
        }
        Insert: {
          approved_at?: string | null
          cancelled_at?: string | null
          cause?: string
          completed_at?: string | null
          created_at?: string
          current_stage_id?: string | null
          document_id: string
          goal_text: string
          id?: string
          organisation_id: string
          sequence_position?: number
          started_at?: string | null
          status?: string
        }
        Update: {
          approved_at?: string | null
          cancelled_at?: string | null
          cause?: string
          completed_at?: string | null
          created_at?: string
          current_stage_id?: string | null
          document_id?: string
          goal_text?: string
          id?: string
          organisation_id?: string
          sequence_position?: number
          started_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "briefs_current_stage_id_fk"
            columns: ["current_stage_id"]
            isOneToOne: false
            referencedRelation: "brief_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "briefs_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "briefs_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      class_1_reserved_slots: {
        Row: {
          id: number
          in_use: number
          total_slots: number
        }
        Insert: {
          id?: number
          in_use?: number
          total_slots: number
        }
        Update: {
          id?: number
          in_use?: number
          total_slots?: number
        }
        Relationships: []
      }
      constraint_violations: {
        Row: {
          attempted_value: number
          configured_cap: number
          context: Json
          created_at: string
          id: string
          organisation_id: string | null
          user_id: string | null
          violation_type: string
        }
        Insert: {
          attempted_value: number
          configured_cap: number
          context?: Json
          created_at?: string
          id?: string
          organisation_id?: string | null
          user_id?: string | null
          violation_type: string
        }
        Update: {
          attempted_value?: number
          configured_cap?: number
          context?: Json
          created_at?: string
          id?: string
          organisation_id?: string | null
          user_id?: string | null
          violation_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "constraint_violations_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_messages: {
        Row: {
          author_user_id: string | null
          cause: string | null
          content: string
          conversation_id: string
          cost_usd: number | null
          created_at: string
          event_payload: Json | null
          event_type: string | null
          id: string
          role: string
          sequence: number
          tokens_cache_read: number | null
          tokens_cache_write: number | null
          tokens_input: number | null
          tokens_output: number | null
          tool_calls: Json | null
          turn_state: string
          workflow_id: string | null
        }
        Insert: {
          author_user_id?: string | null
          cause?: string | null
          content: string
          conversation_id: string
          cost_usd?: number | null
          created_at?: string
          event_payload?: Json | null
          event_type?: string | null
          id?: string
          role: string
          sequence: number
          tokens_cache_read?: number | null
          tokens_cache_write?: number | null
          tokens_input?: number | null
          tokens_output?: number | null
          tool_calls?: Json | null
          turn_state?: string
          workflow_id?: string | null
        }
        Update: {
          author_user_id?: string | null
          cause?: string | null
          content?: string
          conversation_id?: string
          cost_usd?: number | null
          created_at?: string
          event_payload?: Json | null
          event_type?: string | null
          id?: string
          role?: string
          sequence?: number
          tokens_cache_read?: number | null
          tokens_cache_write?: number | null
          tokens_input?: number | null
          tokens_output?: number | null
          tool_calls?: Json | null
          turn_state?: string
          workflow_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversation_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_messages_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          conversation_summary: string | null
          created_at: string
          document_id: string
          id: string
          organisation_id: string
          summary_covers_through: number | null
          updated_at: string
        }
        Insert: {
          conversation_summary?: string | null
          created_at?: string
          document_id: string
          id?: string
          organisation_id: string
          summary_covers_through?: number | null
          updated_at?: string
        }
        Update: {
          conversation_summary?: string | null
          created_at?: string
          document_id?: string
          id?: string
          organisation_id?: string
          summary_covers_through?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: true
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      director_configs: {
        Row: {
          capability_flags: Json
          created_at: string
          deprecated_at: string | null
          display_name: string
          id: string
          model_id: string
          model_params: Json
          promoted_at: string | null
          release_notes: string | null
          status: string
          system_prompt: string
          tool_suite: Json
          version_number: string
        }
        Insert: {
          capability_flags?: Json
          created_at?: string
          deprecated_at?: string | null
          display_name: string
          id?: string
          model_id?: string
          model_params?: Json
          promoted_at?: string | null
          release_notes?: string | null
          status?: string
          system_prompt: string
          tool_suite?: Json
          version_number: string
        }
        Update: {
          capability_flags?: Json
          created_at?: string
          deprecated_at?: string | null
          display_name?: string
          id?: string
          model_id?: string
          model_params?: Json
          promoted_at?: string | null
          release_notes?: string | null
          status?: string
          system_prompt?: string
          tool_suite?: Json
          version_number?: string
        }
        Relationships: []
      }
      director_turns: {
        Row: {
          completed_at: string | null
          conversation_id: string
          id: string
          iteration_count: number
          started_at: string
          status: string
          total_cost_credits: number
          total_input_tokens: number
          total_output_tokens: number
          user_message_id: string | null
        }
        Insert: {
          completed_at?: string | null
          conversation_id: string
          id?: string
          iteration_count?: number
          started_at?: string
          status?: string
          total_cost_credits?: number
          total_input_tokens?: number
          total_output_tokens?: number
          user_message_id?: string | null
        }
        Update: {
          completed_at?: string | null
          conversation_id?: string
          id?: string
          iteration_count?: number
          started_at?: string
          status?: string
          total_cost_credits?: number
          total_input_tokens?: number
          total_output_tokens?: number
          user_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "director_turns_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "director_turns_user_message_id_fkey"
            columns: ["user_message_id"]
            isOneToOne: false
            referencedRelation: "conversation_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      dispatcher_tick_samples: {
        Row: {
          active_throttle_reservations_count: number
          class_1_reserved_slots_in_use: number
          duration_ms: number
          id: number
          queue_depth_class_1: number
          queue_depth_class_2: number
          queue_depth_class_3: number
          queue_depth_class_4: number
          tick_started_at: string
          tickets_considered: number
          tickets_dispatched: number
          tickets_skipped_no_capacity: number
          tickets_skipped_no_dependency: number
          tickets_skipped_stop_requested: number
          tickets_skipped_wrong_route: number
          virtual_clock: number
        }
        Insert: {
          active_throttle_reservations_count: number
          class_1_reserved_slots_in_use: number
          duration_ms: number
          id?: number
          queue_depth_class_1: number
          queue_depth_class_2: number
          queue_depth_class_3: number
          queue_depth_class_4: number
          tick_started_at: string
          tickets_considered: number
          tickets_dispatched: number
          tickets_skipped_no_capacity: number
          tickets_skipped_no_dependency: number
          tickets_skipped_stop_requested: number
          tickets_skipped_wrong_route: number
          virtual_clock: number
        }
        Update: {
          active_throttle_reservations_count?: number
          class_1_reserved_slots_in_use?: number
          duration_ms?: number
          id?: number
          queue_depth_class_1?: number
          queue_depth_class_2?: number
          queue_depth_class_3?: number
          queue_depth_class_4?: number
          tick_started_at?: string
          tickets_considered?: number
          tickets_dispatched?: number
          tickets_skipped_no_capacity?: number
          tickets_skipped_no_dependency?: number
          tickets_skipped_stop_requested?: number
          tickets_skipped_wrong_route?: number
          virtual_clock?: number
        }
        Relationships: []
      }
      documents: {
        Row: {
          authors: string[] | null
          created_at: string
          description: string | null
          director_config_id: string | null
          document_type: string
          export_settings: Json | null
          id: string
          layer_stack_id: string | null
          name: string
          organisation_id: string
          profile_id: string
          project_id: string
          root_node_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          authors?: string[] | null
          created_at?: string
          description?: string | null
          director_config_id?: string | null
          document_type?: string
          export_settings?: Json | null
          id?: string
          layer_stack_id?: string | null
          name: string
          organisation_id: string
          profile_id: string
          project_id: string
          root_node_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          authors?: string[] | null
          created_at?: string
          description?: string | null
          director_config_id?: string | null
          document_type?: string
          export_settings?: Json | null
          id?: string
          layer_stack_id?: string | null
          name?: string
          organisation_id?: string
          profile_id?: string
          project_id?: string
          root_node_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_director_config_id_fkey"
            columns: ["director_config_id"]
            isOneToOne: false
            referencedRelation: "director_configs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_layer_stack_id_fkey"
            columns: ["layer_stack_id"]
            isOneToOne: false
            referencedRelation: "layer_stacks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_profile_id_fk"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "project_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      export_jobs: {
        Row: {
          completed_at: string | null
          created_at: string
          document_id: string
          error_message: string | null
          format: string
          id: string
          organisation_id: string
          signed_url: string | null
          signed_url_expires_at: string | null
          status: string
          storage_path: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          document_id: string
          error_message?: string | null
          format: string
          id?: string
          organisation_id: string
          signed_url?: string | null
          signed_url_expires_at?: string | null
          status?: string
          storage_path?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          document_id?: string
          error_message?: string | null
          format?: string
          id?: string
          organisation_id?: string
          signed_url?: string | null
          signed_url_expires_at?: string | null
          status?: string
          storage_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "export_jobs_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "export_jobs_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      layer_stacks: {
        Row: {
          created_at: string
          document_id: string | null
          document_type: string
          id: string
          is_template: boolean
          layers: Json
          name: string
          organisation_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          document_id?: string | null
          document_type: string
          id?: string
          is_template?: boolean
          layers?: Json
          name: string
          organisation_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          document_id?: string | null
          document_type?: string
          id?: string
          is_template?: boolean
          layers?: Json
          name?: string
          organisation_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_layer_stacks_document"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "layer_stacks_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      node_attachments: {
        Row: {
          created_at: string
          created_by: string
          document_id: string
          file_name: string
          file_size: number
          file_type: string
          id: string
          mime_type: string
          node_id: string
          organisation_id: string
          storage_path: string
        }
        Insert: {
          created_at?: string
          created_by: string
          document_id: string
          file_name: string
          file_size: number
          file_type: string
          id?: string
          mime_type: string
          node_id: string
          organisation_id: string
          storage_path: string
        }
        Update: {
          created_at?: string
          created_by?: string
          document_id?: string
          file_name?: string
          file_size?: number
          file_type?: string
          id?: string
          mime_type?: string
          node_id?: string
          organisation_id?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "node_attachments_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "node_attachments_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "node_attachments_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "nodes_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "node_attachments_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      node_comments: {
        Row: {
          agent_job_id: string | null
          author_label: string
          author_type: string
          comment_type: string
          content: string
          created_at: string
          id: string
          node_id: string
          organisation_id: string
          parent_comment_id: string | null
          resolved: boolean
          resolved_at: string | null
          resolved_by: string | null
        }
        Insert: {
          agent_job_id?: string | null
          author_label: string
          author_type: string
          comment_type: string
          content: string
          created_at?: string
          id?: string
          node_id: string
          organisation_id: string
          parent_comment_id?: string | null
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
        }
        Update: {
          agent_job_id?: string | null
          author_label?: string
          author_type?: string
          comment_type?: string
          content?: string
          created_at?: string
          id?: string
          node_id?: string
          organisation_id?: string
          parent_comment_id?: string | null
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "node_comments_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "node_comments_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "nodes_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "node_comments_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "node_comments_parent_comment_id_fkey"
            columns: ["parent_comment_id"]
            isOneToOne: false
            referencedRelation: "node_comments"
            referencedColumns: ["id"]
          },
        ]
      }
      node_context_links: {
        Row: {
          created_at: string
          id: string
          link_type: string
          organisation_id: string
          source_node_id: string
          target_node_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          link_type?: string
          organisation_id: string
          source_node_id: string
          target_node_id: string
        }
        Update: {
          created_at?: string
          id?: string
          link_type?: string
          organisation_id?: string
          source_node_id?: string
          target_node_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "node_context_links_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "node_context_links_source_node_id_fkey"
            columns: ["source_node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "node_context_links_source_node_id_fkey"
            columns: ["source_node_id"]
            isOneToOne: false
            referencedRelation: "nodes_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "node_context_links_target_node_id_fkey"
            columns: ["target_node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "node_context_links_target_node_id_fkey"
            columns: ["target_node_id"]
            isOneToOne: false
            referencedRelation: "nodes_canonical"
            referencedColumns: ["id"]
          },
        ]
      }
      node_locks: {
        Row: {
          expires_at: string
          id: string
          locked_at: string
          node_id: string
          organisation_id: string
          user_id: string
        }
        Insert: {
          expires_at?: string
          id?: string
          locked_at?: string
          node_id: string
          organisation_id: string
          user_id: string
        }
        Update: {
          expires_at?: string
          id?: string
          locked_at?: string
          node_id?: string
          organisation_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "node_locks_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: true
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "node_locks_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: true
            referencedRelation: "nodes_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "node_locks_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      node_versions: {
        Row: {
          change_reason: string | null
          changed_by: string
          content_revision: number | null
          created_at: string
          id: string
          metadata: Json | null
          node_id: string
          notes: Json | null
          organisation_id: string
          prose: Json | null
          summary: Json | null
          version: number
        }
        Insert: {
          change_reason?: string | null
          changed_by: string
          content_revision?: number | null
          created_at?: string
          id?: string
          metadata?: Json | null
          node_id: string
          notes?: Json | null
          organisation_id: string
          prose?: Json | null
          summary?: Json | null
          version: number
        }
        Update: {
          change_reason?: string | null
          changed_by?: string
          content_revision?: number | null
          created_at?: string
          id?: string
          metadata?: Json | null
          node_id?: string
          notes?: Json | null
          organisation_id?: string
          prose?: Json | null
          summary?: Json | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "node_versions_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "node_versions_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "nodes_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "node_versions_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      nodes: {
        Row: {
          agent_instruction: string | null
          attachment_count: number
          content_revision: number
          created_at: string
          created_by: string | null
          depth: number
          document_id: string | null
          export_heading_override: string | null
          export_include: boolean
          export_page_break_before: boolean
          external_ref: string | null
          id: string
          last_modified_by: string | null
          layer_index: number | null
          lock_reason: string | null
          locked: boolean
          locked_at: string | null
          locked_version: number | null
          metadata: Json | null
          mobile_notes: Json
          name: string | null
          node_category: string
          node_type: string
          notes: Json | null
          order: number
          organisation_id: string
          parent_id: string | null
          project_id: string
          prose: Json | null
          scope: string | null
          short_description: string | null
          status: string
          summary: Json | null
          tags: string[] | null
          updated_at: string
          version: number
          word_count_actual: number | null
          word_count_target: number | null
        }
        Insert: {
          agent_instruction?: string | null
          attachment_count?: number
          content_revision?: number
          created_at?: string
          created_by?: string | null
          depth?: number
          document_id?: string | null
          export_heading_override?: string | null
          export_include?: boolean
          export_page_break_before?: boolean
          external_ref?: string | null
          id?: string
          last_modified_by?: string | null
          layer_index?: number | null
          lock_reason?: string | null
          locked?: boolean
          locked_at?: string | null
          locked_version?: number | null
          metadata?: Json | null
          mobile_notes?: Json
          name?: string | null
          node_category: string
          node_type: string
          notes?: Json | null
          order?: number
          organisation_id: string
          parent_id?: string | null
          project_id: string
          prose?: Json | null
          scope?: string | null
          short_description?: string | null
          status?: string
          summary?: Json | null
          tags?: string[] | null
          updated_at?: string
          version?: number
          word_count_actual?: number | null
          word_count_target?: number | null
        }
        Update: {
          agent_instruction?: string | null
          attachment_count?: number
          content_revision?: number
          created_at?: string
          created_by?: string | null
          depth?: number
          document_id?: string | null
          export_heading_override?: string | null
          export_include?: boolean
          export_page_break_before?: boolean
          external_ref?: string | null
          id?: string
          last_modified_by?: string | null
          layer_index?: number | null
          lock_reason?: string | null
          locked?: boolean
          locked_at?: string | null
          locked_version?: number | null
          metadata?: Json | null
          mobile_notes?: Json
          name?: string | null
          node_category?: string
          node_type?: string
          notes?: Json | null
          order?: number
          organisation_id?: string
          parent_id?: string | null
          project_id?: string
          prose?: Json | null
          scope?: string | null
          short_description?: string | null
          status?: string
          summary?: Json | null
          tags?: string[] | null
          updated_at?: string
          version?: number
          word_count_actual?: number | null
          word_count_target?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "nodes_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nodes_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nodes_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nodes_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "nodes_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nodes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      organisation_invites: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          organisation_id: string
          role: string
          status: string
          token: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at: string
          id?: string
          invited_by: string
          organisation_id: string
          role?: string
          status?: string
          token: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          organisation_id?: string
          role?: string
          status?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "organisation_invites_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      organisation_members: {
        Row: {
          id: string
          invited_at: string | null
          invited_by_user_id: string | null
          joined_at: string
          organisation_id: string
          role: string
          user_id: string
        }
        Insert: {
          id?: string
          invited_at?: string | null
          invited_by_user_id?: string | null
          joined_at?: string
          organisation_id: string
          role?: string
          user_id: string
        }
        Update: {
          id?: string
          invited_at?: string | null
          invited_by_user_id?: string | null
          joined_at?: string
          organisation_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organisation_members_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      organisations: {
        Row: {
          byok_api_key_vault_id: string | null
          byok_enabled: boolean
          byok_provider: string | null
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          id: string
          name: string
          plan: string
          preferred_model_overrides: Json | null
          slug: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_status: string
          updated_at: string
        }
        Insert: {
          byok_api_key_vault_id?: string | null
          byok_enabled?: boolean
          byok_provider?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          name: string
          plan?: string
          preferred_model_overrides?: Json | null
          slug: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string
          updated_at?: string
        }
        Update: {
          byok_api_key_vault_id?: string | null
          byok_enabled?: boolean
          byok_provider?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          name?: string
          plan?: string
          preferred_model_overrides?: Json | null
          slug?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string
          updated_at?: string
        }
        Relationships: []
      }
      platform_config: {
        Row: {
          description: string
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
          value_type: string
        }
        Insert: {
          description: string
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
          value_type: string
        }
        Update: {
          description?: string
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
          value_type?: string
        }
        Relationships: []
      }
      profile_amendments: {
        Row: {
          after: Json
          amendment_type: string
          approved_at: string
          approved_by_user_id: string | null
          before: Json
          created_at: string
          id: string
          profile_id: string
          proposed_by: string
          reason: string | null
          target_path: string | null
        }
        Insert: {
          after: Json
          amendment_type: string
          approved_at?: string
          approved_by_user_id?: string | null
          before?: Json
          created_at?: string
          id?: string
          profile_id: string
          proposed_by: string
          reason?: string | null
          target_path?: string | null
        }
        Update: {
          after?: Json
          amendment_type?: string
          approved_at?: string
          approved_by_user_id?: string | null
          before?: Json
          created_at?: string
          id?: string
          profile_id?: string
          proposed_by?: string
          reason?: string | null
          target_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profile_amendments_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "project_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      project_profiles: {
        Row: {
          created_at: string
          document_id: string
          goal_text: string | null
          id: string
          organisation_id: string
          preferences: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          document_id: string
          goal_text?: string | null
          id?: string
          organisation_id: string
          preferences?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          document_id?: string
          goal_text?: string | null
          id?: string
          organisation_id?: string
          preferences?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_profiles_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: true
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_profiles_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          created_at: string
          default_document_type: string | null
          description: string | null
          id: string
          metadata: Json | null
          name: string
          organisation_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_document_type?: string | null
          description?: string | null
          id?: string
          metadata?: Json | null
          name: string
          organisation_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_document_type?: string | null
          description?: string | null
          id?: string
          metadata?: Json | null
          name?: string
          organisation_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      route_capacity_samples: {
        Row: {
          active_concurrent_calls: number
          bucket_size: number
          current_tokens: number
          id: number
          pool_key: string
          refill_rate: number
          sampled_at: string
        }
        Insert: {
          active_concurrent_calls: number
          bucket_size: number
          current_tokens: number
          id?: number
          pool_key: string
          refill_rate: number
          sampled_at?: string
        }
        Update: {
          active_concurrent_calls?: number
          bucket_size?: number
          current_tokens?: number
          id?: number
          pool_key?: string
          refill_rate?: number
          sampled_at?: string
        }
        Relationships: []
      }
      scheduled_jobs: {
        Row: {
          created_at: string
          created_by: string
          cron_expression: string | null
          defer_count: number
          document_id: string | null
          error_message: string | null
          id: string
          job_config: Json
          job_type: string
          last_run_at: string | null
          last_run_status: string | null
          name: string
          organisation_id: string
          run_at: string
          run_count: number
          schedule_type: string
          status: string
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          cron_expression?: string | null
          defer_count?: number
          document_id?: string | null
          error_message?: string | null
          id?: string
          job_config?: Json
          job_type: string
          last_run_at?: string | null
          last_run_status?: string | null
          name: string
          organisation_id: string
          run_at: string
          run_count?: number
          schedule_type: string
          status?: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          cron_expression?: string | null
          defer_count?: number
          document_id?: string | null
          error_message?: string | null
          id?: string
          job_config?: Json
          job_type?: string
          last_run_at?: string | null
          last_run_status?: string | null
          name?: string
          organisation_id?: string
          run_at?: string
          run_count?: number
          schedule_type?: string
          status?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_jobs_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_jobs_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      stop_requests: {
        Row: {
          cascade_count: number | null
          completed_at: string | null
          id: string
          organisation_id: string
          reason: string | null
          requested_at: string
          requested_by: string
          target_id: string
          target_kind: string
        }
        Insert: {
          cascade_count?: number | null
          completed_at?: string | null
          id?: string
          organisation_id: string
          reason?: string | null
          requested_at?: string
          requested_by: string
          target_id: string
          target_kind: string
        }
        Update: {
          cascade_count?: number | null
          completed_at?: string | null
          id?: string
          organisation_id?: string
          reason?: string | null
          requested_at?: string
          requested_by?: string
          target_id?: string
          target_kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "stop_requests_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          metadata: Json | null
          organisation_id: string
          stripe_event_id: string | null
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json | null
          organisation_id: string
          stripe_event_id?: string | null
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json | null
          organisation_id?: string
          stripe_event_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscription_events_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      throttle_reservations: {
        Row: {
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          organisation_id: string | null
          released_at: string | null
          route: string
          slots_reserved: number
          tokens_reserved: number
          traffic_class: number | null
          user_id: string | null
        }
        Insert: {
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          organisation_id?: string | null
          released_at?: string | null
          route: string
          slots_reserved?: number
          tokens_reserved?: number
          traffic_class?: number | null
          user_id?: string | null
        }
        Update: {
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          organisation_id?: string | null
          released_at?: string | null
          route?: string
          slots_reserved?: number
          tokens_reserved?: number
          traffic_class?: number | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "throttle_reservations_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_records: {
        Row: {
          id: string
          operation_type: string
          organisation_id: string
          provider: string
          tokens_cache_read: number
          tokens_cache_write: number
          tokens_input: number
          tokens_output: number
          updated_at: string
          year_month: string
        }
        Insert: {
          id?: string
          operation_type: string
          organisation_id: string
          provider: string
          tokens_cache_read?: number
          tokens_cache_write?: number
          tokens_input?: number
          tokens_output?: number
          updated_at?: string
          year_month: string
        }
        Update: {
          id?: string
          operation_type?: string
          organisation_id?: string
          provider?: string
          tokens_cache_read?: number
          tokens_cache_write?: number
          tokens_input?: number
          tokens_output?: number
          updated_at?: string
          year_month?: string
        }
        Relationships: [
          {
            foreignKeyName: "usage_records_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_anthropic_keys: {
        Row: {
          created_at: string
          id: string
          last_four: string
          last_validated_at: string
          user_id: string
          vault_secret_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_four: string
          last_validated_at: string
          user_id: string
          vault_secret_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_four?: string
          last_validated_at?: string
          user_id?: string
          vault_secret_id?: string
        }
        Relationships: []
      }
      user_throttle_buckets: {
        Row: {
          bucket_size: number
          created_at: string
          current_tokens: number
          last_refill_at: string
          pool_key: string
          refill_rate: number
          updated_at: string
        }
        Insert: {
          bucket_size: number
          created_at?: string
          current_tokens: number
          last_refill_at?: string
          pool_key: string
          refill_rate: number
          updated_at?: string
        }
        Update: {
          bucket_size?: number
          created_at?: string
          current_tokens?: number
          last_refill_at?: string
          pool_key?: string
          refill_rate?: number
          updated_at?: string
        }
        Relationships: []
      }
      wfq_state: {
        Row: {
          class_1_last_vft: number
          class_2_last_vft: number
          class_3_last_vft: number
          class_4_last_vft: number
          id: number
          updated_at: string
          virtual_clock: number
        }
        Insert: {
          class_1_last_vft?: number
          class_2_last_vft?: number
          class_3_last_vft?: number
          class_4_last_vft?: number
          id?: number
          updated_at?: string
          virtual_clock?: number
        }
        Update: {
          class_1_last_vft?: number
          class_2_last_vft?: number
          class_3_last_vft?: number
          class_4_last_vft?: number
          id?: number
          updated_at?: string
          virtual_clock?: number
        }
        Relationships: []
      }
      workflow_steps: {
        Row: {
          agent_job_id: string | null
          completed_at: string | null
          depends_on_step_orders: number[] | null
          description: string | null
          error_message: string | null
          estimated_duration_seconds: number | null
          id: string
          operation_type: string
          order: number
          parameters: Json | null
          result_summary: string | null
          started_at: string | null
          status: string
          target_node_id: string | null
          workflow_id: string
        }
        Insert: {
          agent_job_id?: string | null
          completed_at?: string | null
          depends_on_step_orders?: number[] | null
          description?: string | null
          error_message?: string | null
          estimated_duration_seconds?: number | null
          id?: string
          operation_type: string
          order: number
          parameters?: Json | null
          result_summary?: string | null
          started_at?: string | null
          status?: string
          target_node_id?: string | null
          workflow_id: string
        }
        Update: {
          agent_job_id?: string | null
          completed_at?: string | null
          depends_on_step_orders?: number[] | null
          description?: string | null
          error_message?: string | null
          estimated_duration_seconds?: number | null
          id?: string
          operation_type?: string
          order?: number
          parameters?: Json | null
          result_summary?: string | null
          started_at?: string | null
          status?: string
          target_node_id?: string | null
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_steps_agent_job_id_fkey"
            columns: ["agent_job_id"]
            isOneToOne: false
            referencedRelation: "agent_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_steps_target_node_id_fkey"
            columns: ["target_node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_steps_target_node_id_fkey"
            columns: ["target_node_id"]
            isOneToOne: false
            referencedRelation: "nodes_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_steps_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      workflows: {
        Row: {
          approved_at: string | null
          completed_at: string | null
          conversation_id: string | null
          created_at: string
          description: string | null
          document_id: string
          error_message: string | null
          estimated_total_minutes: number | null
          id: string
          impact_summary: string | null
          last_heartbeat_at: string | null
          locked_nodes_requiring_unlock: string[] | null
          organisation_id: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          completed_at?: string | null
          conversation_id?: string | null
          created_at?: string
          description?: string | null
          document_id: string
          error_message?: string | null
          estimated_total_minutes?: number | null
          id?: string
          impact_summary?: string | null
          last_heartbeat_at?: string | null
          locked_nodes_requiring_unlock?: string[] | null
          organisation_id: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          completed_at?: string | null
          conversation_id?: string | null
          created_at?: string
          description?: string | null
          document_id?: string
          error_message?: string | null
          estimated_total_minutes?: number | null
          id?: string
          impact_summary?: string | null
          last_heartbeat_at?: string | null
          locked_nodes_requiring_unlock?: string[] | null
          organisation_id?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflows_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflows_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflows_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      nodes_canonical: {
        Row: {
          agent_instruction: string | null
          attachment_count: number | null
          canonical_position: number | null
          content_revision: number | null
          created_at: string | null
          created_by: string | null
          depth: number | null
          document_id: string | null
          export_heading_override: string | null
          export_include: boolean | null
          export_page_break_before: boolean | null
          external_ref: string | null
          id: string | null
          last_modified_by: string | null
          layer_index: number | null
          lock_reason: string | null
          locked: boolean | null
          locked_at: string | null
          locked_version: number | null
          metadata: Json | null
          mobile_notes: Json | null
          name: string | null
          node_category: string | null
          node_type: string | null
          notes: Json | null
          order: number | null
          ordinal_path: number[] | null
          organisation_id: string | null
          parent_id: string | null
          project_id: string | null
          prose: Json | null
          scope: string | null
          short_description: string | null
          status: string | null
          summary: Json | null
          tags: string[] | null
          updated_at: string | null
          version: number | null
          word_count_actual: number | null
          word_count_target: number | null
        }
        Relationships: [
          {
            foreignKeyName: "nodes_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nodes_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nodes_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nodes_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "nodes_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nodes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _emit_system_event: {
        Args: {
          p_cause: string
          p_content: string
          p_document_id: string
          p_event_payload: Json
          p_event_type: string
        }
        Returns: string
      }
      accept_agent_job: {
        Args: {
          p_actor_id: string
          p_child_nodes?: Json
          p_job_id: string
          p_target_metadata?: Json
          p_target_notes?: string
          p_target_prose?: string
          p_target_summary?: string
        }
        Returns: {
          out_child_node_ids: string[]
          out_new_version: number
          out_node_id: string
        }[]
      }
      accept_brief: {
        Args: { p_document_id: string; p_goal_text: string; p_stages: Json }
        Returns: Json
      }
      apply_profile_amendment: {
        Args: {
          p_after: Json
          p_amendment_type: string
          p_profile_id: string
          p_reason: string
          p_target_path: string
        }
        Returns: Json
      }
      cancel_brief: {
        Args: { p_brief_id: string; p_reason?: string }
        Returns: Json
      }
      classify_failure: {
        Args: {
          p_error_code: string
          p_http_status: number
          p_operation_type: string
          p_retry_count: number
        }
        Returns: string
      }
      complete_brief_stage: { Args: { p_stage_id: string }; Returns: Json }
      complete_brief_stage_workflow: {
        Args: { p_workflow_id: string }
        Returns: Json
      }
      create_document_with_layer_stack: {
        Args: {
          p_authors: string[]
          p_description: string
          p_document_type: string
          p_name: string
          p_organisation_id: string
          p_project_id: string
        }
        Returns: Json
      }
      delete_user_anthropic_key: { Args: never; Returns: Json }
      evaluate_ready_stage_triggers: { Args: never; Returns: number }
      get_user_anthropic_key_for_byok_call: {
        Args: { p_user_id: string }
        Returns: string
      }
      get_user_anthropic_key_status: { Args: never; Returns: Json }
      move_node: {
        Args: { p_node_id: string; p_parent_id: string; p_position: number }
        Returns: Json
      }
      promote_next_queued_brief: {
        Args: { p_document_id: string }
        Returns: string
      }
      propagate_brief_completion: {
        Args: { p_brief_id: string }
        Returns: Json
      }
      save_user_anthropic_key: {
        Args: { p_key: string; p_validation_completed_at: string }
        Returns: Json
      }
      scheduler_sweep_interrupted_iterations: {
        Args: { p_stale_threshold_seconds?: number }
        Returns: number
      }
      scheduler_sweep_throttle_reservations: { Args: never; Returns: number }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

