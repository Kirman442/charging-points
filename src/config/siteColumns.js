// Shared by Parquet projection and the site-details response.
export const SITE_DETAIL_COLUMNS = [
  'city', 'street', 'house_number', 'postal_code', 'state_name', 'operator',
  'district_name', 'equipment_count', 'installed_power_kw', 'charging_point_count',
  'opening_hours_label', 'operating_point_count', 'maintenance_point_count',
]
export const SITE_COLUMNS = [
  'site_id', 'longitude', 'latitude', 'max_power_kw', 'dc_point_count',
  'opening_hours_type', 'source_date', 'available_power_kw', ...SITE_DETAIL_COLUMNS,
]
