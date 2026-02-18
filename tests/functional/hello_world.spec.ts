import { test } from '@japa/runner'

test.group('Hello world', () => {
  test('get home page', async ({ client }) => {
    const response = await client.get('/').accept('json')
    response.assertStatus(200)
    response.assertBodyContains({ status: 'ok' })
  })

  test('get healthcheck', async ({ client }) => {
    const response = await client.get('/healthcheck')
    response.assertStatus(200)
  })
})
