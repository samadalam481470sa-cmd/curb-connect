export function jobsitePhotoKey(orgId: string, id: string, part?: number): string {
  const root = 'orgs/' + orgId + '/enterprise/jobsite-media/' + id;
  return part === undefined ? root + '/original' : root + '/parts/' + part;
}
