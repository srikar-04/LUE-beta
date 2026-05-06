export type UserRole = 'admin' | 'teacher' | 'parent' | 'student';

export type DataCategory =
  | 'general'
  | 'academic'
  | 'attendance'
  | 'financial'
  | 'personal';

export interface DocumentMetadata {
  school_id: string;
  data_category: DataCategory;
  access_roles: string[];
  entity_type: string;
  content_summary: string;
  student_id?: string;
  class_id?: string;
  teacher_id?: string;
  created_at: number;
}

export interface SessionContext {
  school_id: string;
  user_id: string;
  role: UserRole;
  name: string;
  teacher_id?: string;
  class_ids?: string[];
  student_id?: string;
  parent_id?: string;
  student_ids?: string[];
}

export interface IngestDocument {
  id: string;
  content: string;
  metadata: DocumentMetadata;
}

export interface IngestRequest {
  schoolId: string;
  documents: IngestDocument[];
}

export interface IngestResult {
  success: boolean;
  ingested: number;
  chunks_created: number;
  latency_ms: number;
  errors?: string[];
}

export interface RetrievedChunk {
  id: string;
  content: string;
  metadata: DocumentMetadata;
  score: number;
}

export interface QueryRequest {
  query: string;
  top_k?: number;
}

export interface CacheEntry {
  vector: number[];
  expires_at: number;
}

export interface VectorRecord {
  id: string;
  values: number[];
  metadata: Record<string, string | number | boolean | string[]>;
}
