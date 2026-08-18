export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_events: {
        Row: {
          actor_id: string | null
          at: string
          detail: Json
          device_id: number | null
          event_type: string
          id: number
          ref_id: string | null
          ref_type: string
          summary: string
        }
        Insert: {
          actor_id?: string | null
          at?: string
          detail?: Json
          device_id?: number | null
          event_type: string
          id?: number
          ref_id?: string | null
          ref_type: string
          summary: string
        }
        Update: {
          actor_id?: string | null
          at?: string
          detail?: Json
          device_id?: number | null
          event_type?: string
          id?: number
          ref_id?: string | null
          ref_type?: string
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_events_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "pos_devices"
            referencedColumns: ["id"]
          },
        ]
      }
      brands: {
        Row: {
          id: number
          is_active: boolean
          name: string
        }
        Insert: {
          id?: number
          is_active?: boolean
          name: string
        }
        Update: {
          id?: number
          is_active?: boolean
          name?: string
        }
        Relationships: []
      }
      categories: {
        Row: {
          id: number
          is_active: boolean
          name: string
          parent_id: number | null
        }
        Insert: {
          id?: number
          is_active?: boolean
          name: string
          parent_id?: number | null
        }
        Update: {
          id?: number
          is_active?: boolean
          name?: string
          parent_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      colours: {
        Row: {
          hex_code: string | null
          id: number
          is_active: boolean
          name: string
        }
        Insert: {
          hex_code?: string | null
          id?: number
          is_active?: boolean
          name: string
        }
        Update: {
          hex_code?: string | null
          id?: number
          is_active?: boolean
          name?: string
        }
        Relationships: []
      }
      credit_note_items: {
        Row: {
          credit_note_id: number
          id: number
          line_total: number
          qty: number
          sale_item_id: number
          unit_price: number
          variant_id: number | null
        }
        Insert: {
          credit_note_id: number
          id?: number
          line_total: number
          qty: number
          sale_item_id: number
          unit_price: number
          variant_id?: number | null
        }
        Update: {
          credit_note_id?: number
          id?: number
          line_total?: number
          qty?: number
          sale_item_id?: number
          unit_price?: number
          variant_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "credit_note_items_credit_note_id_fkey"
            columns: ["credit_note_id"]
            isOneToOne: false
            referencedRelation: "credit_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_note_items_sale_item_id_fkey"
            columns: ["sale_item_id"]
            isOneToOne: false
            referencedRelation: "sale_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_note_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "low_stock_variants"
            referencedColumns: ["variant_id"]
          },
          {
            foreignKeyName: "credit_note_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_notes: {
        Row: {
          cashier_id: string | null
          created_at: string
          credit_no: string
          id: number
          reason: string
          refund_method: string
          sale_id: number
          shift_id: number | null
          subtotal: number
          total: number
          vat_amount: number
          vat_enabled: boolean
          vat_number: string | null
          vat_policy_id: number
          vat_rate: number
        }
        Insert: {
          cashier_id?: string | null
          created_at?: string
          credit_no: string
          id?: number
          reason: string
          refund_method: string
          sale_id: number
          shift_id?: number | null
          subtotal: number
          total: number
          vat_amount?: number
          vat_enabled: boolean
          vat_number?: string | null
          vat_policy_id: number
          vat_rate: number
        }
        Update: {
          cashier_id?: string | null
          created_at?: string
          credit_no?: string
          id?: number
          reason?: string
          refund_method?: string
          sale_id?: number
          shift_id?: number | null
          subtotal?: number
          total?: number
          vat_amount?: number
          vat_enabled?: boolean
          vat_number?: string | null
          vat_policy_id?: number
          vat_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "credit_notes_cashier_id_fkey"
            columns: ["cashier_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_notes_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "late_sales"
            referencedColumns: ["sale_id"]
          },
          {
            foreignKeyName: "credit_notes_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_notes_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_notes_vat_policy_id_fkey"
            columns: ["vat_policy_id"]
            isOneToOne: false
            referencedRelation: "vat_policies"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          created_at: string
          email: string | null
          full_name: string
          id: number
          notes: string | null
          phone: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name: string
          id?: number
          notes?: string | null
          phone?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string
          id?: number
          notes?: string | null
          phone?: string | null
        }
        Relationships: []
      }
      discounts: {
        Row: {
          category_id: number | null
          code: string | null
          created_at: string
          ends_on: string | null
          id: number
          is_active: boolean
          kind: string
          max_amount: number | null
          min_spend: number
          name: string
          requires_manager: boolean
          scope: string
          starts_on: string | null
          value: number
        }
        Insert: {
          category_id?: number | null
          code?: string | null
          created_at?: string
          ends_on?: string | null
          id?: number
          is_active?: boolean
          kind: string
          max_amount?: number | null
          min_spend?: number
          name: string
          requires_manager?: boolean
          scope?: string
          starts_on?: string | null
          value: number
        }
        Update: {
          category_id?: number | null
          code?: string | null
          created_at?: string
          ends_on?: string | null
          id?: number
          is_active?: boolean
          kind?: string
          max_amount?: number | null
          min_spend?: number
          name?: string
          requires_manager?: boolean
          scope?: string
          starts_on?: string | null
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "discounts_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      module_access: {
        Row: {
          can_view: boolean
          id: number
          module: string
          role: string
        }
        Insert: {
          can_view?: boolean
          id?: number
          module: string
          role: string
        }
        Update: {
          can_view?: boolean
          id?: number
          module?: string
          role?: string
        }
        Relationships: []
      }
      pos_devices: {
        Row: {
          app_version: string | null
          code: string
          created_at: string
          id: number
          is_active: boolean
          is_back_office: boolean
          last_seen_at: string | null
          model: string | null
          name: string
        }
        Insert: {
          app_version?: string | null
          code: string
          created_at?: string
          id?: number
          is_active?: boolean
          is_back_office?: boolean
          last_seen_at?: string | null
          model?: string | null
          name: string
        }
        Update: {
          app_version?: string | null
          code?: string
          created_at?: string
          id?: number
          is_active?: boolean
          is_back_office?: boolean
          last_seen_at?: string | null
          model?: string | null
          name?: string
        }
        Relationships: []
      }
      product_variants: {
        Row: {
          barcode: string | null
          colour_id: number
          cost_price: number
          id: number
          is_active: boolean
          product_id: number
          qty_on_hand: number
          reorder_level: number
          selling_price: number
          size_id: number
          sku: string
        }
        Insert: {
          barcode?: string | null
          colour_id: number
          cost_price?: number
          id?: number
          is_active?: boolean
          product_id: number
          qty_on_hand?: number
          reorder_level?: number
          selling_price: number
          size_id: number
          sku: string
        }
        Update: {
          barcode?: string | null
          colour_id?: number
          cost_price?: number
          id?: number
          is_active?: boolean
          product_id?: number
          qty_on_hand?: number
          reorder_level?: number
          selling_price?: number
          size_id?: number
          sku?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_colour_id_fkey"
            columns: ["colour_id"]
            isOneToOne: false
            referencedRelation: "colours"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "stock_by_location"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_variants_size_id_fkey"
            columns: ["size_id"]
            isOneToOne: false
            referencedRelation: "sizes"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          brand_id: number | null
          category_id: number
          created_at: string
          description: string | null
          gender: string
          id: number
          image_url: string | null
          is_active: boolean
          name: string
          shelf_location: string | null
        }
        Insert: {
          brand_id?: number | null
          category_id: number
          created_at?: string
          description?: string | null
          gender?: string
          id?: number
          image_url?: string | null
          is_active?: boolean
          name: string
          shelf_location?: string | null
        }
        Update: {
          brand_id?: number | null
          category_id?: number
          created_at?: string
          description?: string | null
          gender?: string
          id?: number
          image_url?: string | null
          is_active?: boolean
          name?: string
          shelf_location?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string
          id: string
          is_active: boolean
          pin_code: string | null
          pin_device_verifier: string | null
          pin_failed_count: number
          pin_last_used_at: string | null
          pin_locked_until: string | null
          role: string
        }
        Insert: {
          created_at?: string
          full_name: string
          id: string
          is_active?: boolean
          pin_code?: string | null
          pin_device_verifier?: string | null
          pin_failed_count?: number
          pin_last_used_at?: string | null
          pin_locked_until?: string | null
          role?: string
        }
        Update: {
          created_at?: string
          full_name?: string
          id?: string
          is_active?: boolean
          pin_code?: string | null
          pin_device_verifier?: string | null
          pin_failed_count?: number
          pin_last_used_at?: string | null
          pin_locked_until?: string | null
          role?: string
        }
        Relationships: []
      }
      purchase_items: {
        Row: {
          id: number
          line_total: number | null
          purchase_id: number
          qty: number
          unit_cost: number
          variant_id: number
        }
        Insert: {
          id?: number
          line_total?: number | null
          purchase_id: number
          qty: number
          unit_cost: number
          variant_id: number
        }
        Update: {
          id?: number
          line_total?: number | null
          purchase_id?: number
          qty?: number
          unit_cost?: number
          variant_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_items_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "low_stock_variants"
            referencedColumns: ["variant_id"]
          },
          {
            foreignKeyName: "purchase_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      purchases: {
        Row: {
          created_at: string
          created_by: string | null
          expected_date: string | null
          id: number
          invoice_no: string | null
          notes: string | null
          purchase_date: string
          status: string
          supplier_id: number
          total_amount: number
          vat_amount: number | null
          vat_enabled: boolean | null
          vat_policy_id: number | null
          vat_rate: number | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expected_date?: string | null
          id?: number
          invoice_no?: string | null
          notes?: string | null
          purchase_date?: string
          status?: string
          supplier_id: number
          total_amount?: number
          vat_amount?: number | null
          vat_enabled?: boolean | null
          vat_policy_id?: number | null
          vat_rate?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expected_date?: string | null
          id?: number
          invoice_no?: string | null
          notes?: string | null
          purchase_date?: string
          status?: string
          supplier_id?: number
          total_amount?: number
          vat_amount?: number | null
          vat_enabled?: boolean | null
          vat_policy_id?: number | null
          vat_rate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "purchases_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_vat_policy_id_fkey"
            columns: ["vat_policy_id"]
            isOneToOne: false
            referencedRelation: "vat_policies"
            referencedColumns: ["id"]
          },
        ]
      }
      receipt_prints: {
        Row: {
          id: number
          printed_at: string
          printed_by: string | null
          sale_id: number
        }
        Insert: {
          id?: number
          printed_at?: string
          printed_by?: string | null
          sale_id: number
        }
        Update: {
          id?: number
          printed_at?: string
          printed_by?: string | null
          sale_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "receipt_prints_printed_by_fkey"
            columns: ["printed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_prints_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "late_sales"
            referencedColumns: ["sale_id"]
          },
          {
            foreignKeyName: "receipt_prints_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_discounts: {
        Row: {
          amount: number
          approved_by: string | null
          discount_id: number | null
          id: number
          kind: string
          label: string
          sale_id: number
          value: number
        }
        Insert: {
          amount: number
          approved_by?: string | null
          discount_id?: number | null
          id?: number
          kind: string
          label: string
          sale_id: number
          value: number
        }
        Update: {
          amount?: number
          approved_by?: string | null
          discount_id?: number | null
          id?: number
          kind?: string
          label?: string
          sale_id?: number
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "sale_discounts_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_discounts_discount_id_fkey"
            columns: ["discount_id"]
            isOneToOne: false
            referencedRelation: "discounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_discounts_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "late_sales"
            referencedColumns: ["sale_id"]
          },
          {
            foreignKeyName: "sale_discounts_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_items: {
        Row: {
          description: string | null
          discount: number
          id: number
          line_total: number
          qty: number
          sale_id: number
          unit_price: number
          variant_id: number | null
        }
        Insert: {
          description?: string | null
          discount?: number
          id?: number
          line_total: number
          qty: number
          sale_id: number
          unit_price: number
          variant_id?: number | null
        }
        Update: {
          description?: string | null
          discount?: number
          id?: number
          line_total?: number
          qty?: number
          sale_id?: number
          unit_price?: number
          variant_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "late_sales"
            referencedColumns: ["sale_id"]
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "low_stock_variants"
            referencedColumns: ["variant_id"]
          },
          {
            foreignKeyName: "sale_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_payments: {
        Row: {
          amount: number
          created_at: string
          id: number
          method: string
          sale_id: number
          tendered: number | null
        }
        Insert: {
          amount: number
          created_at?: string
          id?: number
          method: string
          sale_id: number
          tendered?: number | null
        }
        Update: {
          amount?: number
          created_at?: string
          id?: number
          method?: string
          sale_id?: number
          tendered?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sale_payments_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "late_sales"
            referencedColumns: ["sale_id"]
          },
          {
            foreignKeyName: "sale_payments_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          cashier_id: string | null
          customer_id: number | null
          discount: number
          id: number
          idempotency_key: string | null
          sale_date: string
          sale_no: string
          shift_id: number | null
          status: string
          subtotal: number
          total: number
          vat_amount: number
          vat_enabled: boolean
          vat_number: string | null
          vat_policy_id: number
          vat_rate: number
        }
        Insert: {
          cashier_id?: string | null
          customer_id?: number | null
          discount?: number
          id?: number
          idempotency_key?: string | null
          sale_date?: string
          sale_no: string
          shift_id?: number | null
          status?: string
          subtotal: number
          total: number
          vat_amount?: number
          vat_enabled: boolean
          vat_number?: string | null
          vat_policy_id: number
          vat_rate: number
        }
        Update: {
          cashier_id?: string | null
          customer_id?: number | null
          discount?: number
          id?: number
          idempotency_key?: string | null
          sale_date?: string
          sale_no?: string
          shift_id?: number | null
          status?: string
          subtotal?: number
          total?: number
          vat_amount?: number
          vat_enabled?: boolean
          vat_number?: string | null
          vat_policy_id?: number
          vat_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "sales_cashier_id_fkey"
            columns: ["cashier_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_vat_policy_id_fkey"
            columns: ["vat_policy_id"]
            isOneToOne: false
            referencedRelation: "vat_policies"
            referencedColumns: ["id"]
          },
        ]
      }
      settings: {
        Row: {
          key: string
          value: Json
        }
        Insert: {
          key: string
          value: Json
        }
        Update: {
          key?: string
          value?: Json
        }
        Relationships: []
      }
      shifts: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          counted_cash: number | null
          device_id: number | null
          expected_cash: number | null
          id: number
          notes: string | null
          opened_at: string
          opened_by: string
          opening_float: number
          variance: number | null
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          counted_cash?: number | null
          device_id?: number | null
          expected_cash?: number | null
          id?: number
          notes?: string | null
          opened_at?: string
          opened_by: string
          opening_float?: number
          variance?: number | null
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          counted_cash?: number | null
          device_id?: number | null
          expected_cash?: number | null
          id?: number
          notes?: string | null
          opened_at?: string
          opened_by?: string
          opening_float?: number
          variance?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "shifts_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "pos_devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_opened_by_fkey"
            columns: ["opened_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sizes: {
        Row: {
          id: number
          is_active: boolean
          label: string
          size_type: string
          sort_order: number
        }
        Insert: {
          id?: number
          is_active?: boolean
          label: string
          size_type: string
          sort_order?: number
        }
        Update: {
          id?: number
          is_active?: boolean
          label?: string
          size_type?: string
          sort_order?: number
        }
        Relationships: []
      }
      stock_locations: {
        Row: {
          id: number
          is_active: boolean
          is_default: boolean
          name: string
        }
        Insert: {
          id?: number
          is_active?: boolean
          is_default?: boolean
          name: string
        }
        Update: {
          id?: number
          is_active?: boolean
          is_default?: boolean
          name?: string
        }
        Relationships: []
      }
      stock_movements: {
        Row: {
          created_at: string
          created_by: string | null
          id: number
          location_id: number | null
          movement_type: string
          notes: string | null
          qty: number
          reference_id: number | null
          reference_type: string | null
          variant_id: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: number
          location_id?: number | null
          movement_type: string
          notes?: string | null
          qty: number
          reference_id?: number | null
          reference_type?: string | null
          variant_id: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: number
          location_id?: number | null
          movement_type?: string
          notes?: string | null
          qty?: number
          reference_id?: number | null
          reference_type?: string | null
          variant_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "stock_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "low_stock_variants"
            referencedColumns: ["variant_id"]
          },
          {
            foreignKeyName: "stock_movements_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          address: string | null
          contact_name: string | null
          email: string | null
          id: number
          is_active: boolean
          name: string
          payment_terms: string | null
          phone: string | null
          town: string | null
        }
        Insert: {
          address?: string | null
          contact_name?: string | null
          email?: string | null
          id?: number
          is_active?: boolean
          name: string
          payment_terms?: string | null
          phone?: string | null
          town?: string | null
        }
        Update: {
          address?: string | null
          contact_name?: string | null
          email?: string | null
          id?: number
          is_active?: boolean
          name?: string
          payment_terms?: string | null
          phone?: string | null
          town?: string | null
        }
        Relationships: []
      }
      till_movements: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          id: number
          reason: string
          shift_id: number
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          id?: number
          reason: string
          shift_id: number
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          id?: number
          reason?: string
          shift_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "till_movements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "till_movements_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      vat_policies: {
        Row: {
          configured_rate: number
          created_at: string
          created_by: string | null
          enabled: boolean
          id: number
          is_legacy: boolean
          vat_number: string | null
        }
        Insert: {
          configured_rate: number
          created_at?: string
          created_by?: string | null
          enabled: boolean
          id?: number
          is_legacy?: boolean
          vat_number?: string | null
        }
        Update: {
          configured_rate?: number
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          id?: number
          is_legacy?: boolean
          vat_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vat_policies_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      z_reports: {
        Row: {
          closed_at: string
          closed_by: string | null
          counted_cash: number
          expected_cash: number
          id: number
          shift_id: number
          totals: Json
          variance: number
          vat_identity_snapshot: Json
          z_no: string
        }
        Insert: {
          closed_at?: string
          closed_by?: string | null
          counted_cash?: number
          expected_cash?: number
          id?: number
          shift_id: number
          totals: Json
          variance?: number
          vat_identity_snapshot?: Json
          z_no: string
        }
        Update: {
          closed_at?: string
          closed_by?: string | null
          counted_cash?: number
          expected_cash?: number
          id?: number
          shift_id?: number
          totals?: Json
          variance?: number
          vat_identity_snapshot?: Json
          z_no?: string
        }
        Relationships: [
          {
            foreignKeyName: "z_reports_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "z_reports_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: true
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      late_sales: {
        Row: {
          arrived_after: string | null
          closed_at: string | null
          sale_date: string | null
          sale_id: number | null
          sale_no: string | null
          shift_id: number | null
          total: number | null
          z_no: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      low_stock_variants: {
        Row: {
          barcode: string | null
          colour_hex: string | null
          colour_name: string | null
          cost_price: number | null
          product_id: number | null
          product_name: string | null
          qty_on_hand: number | null
          reorder_level: number | null
          selling_price: number | null
          size_label: string | null
          size_type: string | null
          sku: string | null
          variant_id: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "stock_by_location"
            referencedColumns: ["product_id"]
          },
        ]
      }
      shift_z_variance: {
        Row: {
          actual_total: number | null
          closed_at: string | null
          late_count: number | null
          shift_id: number | null
          unreported: number | null
          z_no: string | null
          z_total: number | null
        }
        Insert: {
          actual_total?: never
          closed_at?: string | null
          late_count?: never
          shift_id?: number | null
          unreported?: never
          z_no?: string | null
          z_total?: never
        }
        Update: {
          actual_total?: never
          closed_at?: string | null
          late_count?: never
          shift_id?: number | null
          unreported?: never
          z_no?: string | null
          z_total?: never
        }
        Relationships: [
          {
            foreignKeyName: "z_reports_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: true
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_by_location: {
        Row: {
          colour_hex: string | null
          colour_name: string | null
          location_id: number | null
          location_name: string | null
          product_id: number | null
          product_name: string | null
          qty_on_hand: number | null
          size_label: string | null
          sku: string | null
          variant_id: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "stock_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "low_stock_variants"
            referencedColumns: ["variant_id"]
          },
          {
            foreignKeyName: "stock_movements_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      allocate_barcode_serials: { Args: { p_count: number }; Returns: number }
      clear_pin_lock: { Args: { p_profile_id: string }; Returns: undefined }
      close_shift_z: {
        Args: { p_counted_cash: number; p_notes?: string; p_shift_id: number }
        Returns: Json
      }
      complete_sale: {
        Args: {
          p_cashier_id: string
          p_customer_id: number
          p_discount: number
          p_items: Json
          p_payments: Json
          p_shift_id: number
        }
        Returns: number
      }
      complete_sale_keyed: {
        Args: {
          p_cashier_id: string
          p_customer_id: number
          p_discount: number
          p_discounts?: Json
          p_items: Json
          p_key: string
          p_payments: Json
          p_shift_id: number
        }
        Returns: number
      }
      complete_sale_with_discounts: {
        Args: {
          p_cashier_id: string
          p_customer_id: number
          p_discount: number
          p_discounts?: Json
          p_items: Json
          p_payments: Json
          p_shift_id: number
        }
        Returns: number
      }
      create_credit_note: {
        Args: {
          p_cashier_id: string
          p_items: Json
          p_reason: string
          p_refund_method: string
          p_restock?: boolean
          p_sale_id: number
          p_shift_id: number
        }
        Returns: number
      }
      current_role_of_user: { Args: never; Returns: string }
      daily_summary: { Args: { p_from: string; p_to: string }; Returns: Json }
      discount_amount_for: {
        Args: {
          p_base: number
          p_kind: string
          p_max_amount?: number
          p_value: number
        }
        Returns: number
      }
      discount_report: {
        Args: { p_from: string; p_to: string }
        Returns: {
          discount_id: number
          label: string
          times_used: number
          total_given: number
        }[]
      }
      log_audit: {
        Args: {
          p_detail?: Json
          p_event_type: string
          p_ref_id: string
          p_ref_type: string
          p_summary: string
        }
        Returns: undefined
      }
      pin_lock_state: { Args: { p_profile_id: string }; Returns: number }
      receive_purchase: { Args: { p_purchase_id: number }; Returns: undefined }
      record_receipt_print: { Args: { p_sale_id: number }; Returns: number }
      record_stock_movement: {
        Args: {
          p_notes?: string
          p_qty: number
          p_reference_id?: number
          p_reference_type?: string
          p_type: string
          p_variant_id: number
        }
        Returns: number
      }
      record_stock_movement_at: {
        Args: {
          p_location_id: number
          p_notes?: string
          p_qty: number
          p_reference_id?: number
          p_reference_type?: string
          p_type: string
          p_variant_id: number
        }
        Returns: number
      }
      record_till_movement: {
        Args: { p_amount: number; p_reason: string; p_shift_id: number }
        Returns: number
      }
      register_pin_attempt: {
        Args: { p_ok: boolean; p_profile_id: string }
        Returns: number
      }
      register_pos_device: {
        Args: { p_app_version?: string; p_code: string; p_model?: string }
        Returns: number
      }
      returned_qty: { Args: { p_sale_item_id: number }; Returns: number }
      set_vat_policy: {
        Args: {
          p_configured_rate: number
          p_enabled: boolean
          p_vat_number: string | null
        }
        Returns: number
      }
      set_barcode_scheme: {
        Args: { p_auto: boolean; p_next: number; p_prefix: string }
        Returns: number
      }
      shift_totals: { Args: { p_shift_id: number }; Returns: Json }
      transfer_stock: {
        Args: {
          p_from_location: number
          p_notes?: string
          p_qty: number
          p_to_location: number
          p_variant_id: number
        }
        Returns: undefined
      }
      z_totals: {
        Args: { p_as_at?: string; p_shift_id: number }
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
  public: {
    Enums: {},
  },
} as const
