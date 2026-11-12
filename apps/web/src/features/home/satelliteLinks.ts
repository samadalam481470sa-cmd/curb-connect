/** Safe, vendor-hosted links. Google 3D is never scraped or misrepresented as native app imagery. */
export function validCoordinates(lat: number, lon: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lon) &&
    lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}
export function googleSatelliteUrl(lat: number, lon: number): string {
  if (!validCoordinates(lat, lon)) throw new Error('Invalid satellite coordinates');
  return 'https://www.google.com/maps/@' + lat.toFixed(6) + ',' + lon.toFixed(6) +
    ',19z/data=!3m1!1e3';
}
export function earthSearchUrl(query: string, lat: number, lon: number): string {
  if (!validCoordinates(lat, lon)) throw new Error('Invalid Google Earth coordinates');
  const location = query.trim() && !query.includes('example')
    ? query.trim() : lat.toFixed(6) + ',' + lon.toFixed(6);
  return 'https://earth.google.com/web/search/' + encodeURIComponent(location);
}
