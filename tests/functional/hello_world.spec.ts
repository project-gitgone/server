import { test } from '@japa/runner'
import env from '#start/env'

test.group('Hello world', (group) => {
  group.each.teardown(() => env.set('STATUS_PAGE', true))

  test('get home page', async ({ client }) => {
    const response = await client.get('/').accept('json')
    response.assertStatus(200)
    response.assertBodyContains({ status: 'ok' })
  })

  test('the home page shows the state of the instance', async ({ client, assert }) => {
    const response = await client.get('/').accept('html')
    response.assertStatus(200)
    assert.include(response.text(), 'Instance à configurer')
  })

  test('the home page can be hidden without breaking the status endpoint', async ({ client }) => {
    env.set('STATUS_PAGE', false)
    const html = await client.get('/').accept('html')
    html.assertStatus(404)
    const json = await client.get('/').accept('json')
    json.assertStatus(200)
  })

  test('get healthcheck', async ({ client }) => {
    const response = await client.get('/healthcheck')
    response.assertStatus(200)
  })
})
