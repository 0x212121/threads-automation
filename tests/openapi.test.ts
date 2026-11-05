import test from 'node:test';
import assert from 'node:assert/strict';
import SwaggerParser from '@apidevtools/swagger-parser';

test('kontrak OpenAPI awal valid dan mendokumentasikan endpoint autentikasi', async () => {
  const api = await SwaggerParser.validate('openapi.json');
  assert.ok(api.paths?.['/api/auth/csrf']?.get);
  assert.ok(api.paths?.['/api/auth/login']?.post);
  assert.ok(api.paths?.['/api/auth/me']?.get);
  assert.ok(api.paths?.['/api/auth/logout']?.post);
  assert.ok(api.paths?.['/api/auth/verification/request']?.post);
  assert.ok(api.paths?.['/api/auth/verification/confirm']?.post);
  assert.ok(api.paths?.['/api/auth/password-reset/request']?.post);
  assert.ok(api.paths?.['/api/auth/password-reset/confirm']?.post);
  assert.ok(api.paths?.['/api/invitations']?.post);
  assert.ok(api.paths?.['/api/invitations/accept']?.post);
  assert.ok(api.paths?.['/api/threads/accounts']?.get);
  assert.ok(api.paths?.['/api/threads/oauth/start']?.post);
  assert.ok(api.paths?.['/api/threads/oauth/callback']?.get);
  assert.ok(api.paths?.['/api/media']?.post);
  assert.ok(api.paths?.['/api/media/{id}/content']?.get);
  assert.ok(api.paths?.['/api/media/{id}']?.delete);
  assert.ok(api.paths?.['/media-fetch/{job}/{id}/{expires}/{signature}']?.get);
  assert.ok(api.paths?.['/api/posts/{id}/schedule']?.post);
  assert.ok(api.paths?.['/api/posts/{id}/publish-now']?.post);
  assert.ok(api.paths?.['/api/posts/{id}/schedules/{jobId}/{action}']?.post);
  assert.ok(api.paths?.['/api/posts/{id}/schedules/{jobId}/resolve']?.post);
});
