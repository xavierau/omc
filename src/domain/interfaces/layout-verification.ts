export interface NormBBox {
  x: number
  y: number
  w: number
  h: number
}

export interface TemplateRegion {
  label: string
  bbox_norm: NormBBox
  bbox_std: NormBBox
  confidence_mean: number
  occurrence_rate: number
}

export interface SpatialRelation {
  from_label: string
  to_label: string
  relation: string
  gap_norm: number
}

export interface LayoutTemplate {
  version: number
  aspect_ratio: { mean: number; std: number }
  regions: TemplateRegion[]
  region_count: { mean: number; std: number }
  spatial_graph: SpatialRelation[]
  created_from: number
}

export interface LayoutVerificationResult {
  score: number
  passed: boolean
  aspect_ratio_score: number
  region_match_score: number
  spatial_score: number
  missing_regions: string[]
  extra_regions: string[]
}
