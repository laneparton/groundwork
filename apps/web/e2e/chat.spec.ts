import { expect, test, type Page } from '@playwright/test'

// Each test signs up its own user, so tests share no conversations.
async function signUp(page: Page) {
  const email = `e2e-${test.info().testId}-${Date.now()}@example.test`

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  await page.getByRole('button', { name: 'Create an account' }).click()
  await page.getByLabel('Name').fill('E2E Tester')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('e2e-password-123')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(composer(page)).toBeVisible()
}

const composer = (page: Page) => page.getByPlaceholder('Ask anything')
const chat = (page: Page) => page.getByRole('main', { name: 'Chat' })

async function send(page: Page, text: string) {
  await composer(page).fill(text)
  await composer(page).press('Enter')
}

// Waits for the reply the fake model gives to `text`.
async function expectReply(page: Page, text: string, items?: number) {
  const reply =
    items === undefined ? `Reply to "${text}"` : `Reply to "${text}" after ${items} items.`

  await expect(chat(page).getByText(reply)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Stop generating' })).toBeHidden()
}

// Reloads the app and opens the conversation from the sidebar.
async function reopen(page: Page, title: string) {
  await page.reload()
  await page
    .getByRole('complementary', { name: 'Conversations' })
    .getByRole('button', { name: title })
    .click()
}

test('a new user can chat, and the conversation survives a reload', async ({ page }) => {
  await signUp(page)

  await send(page, 'First question')
  await expectReply(page, 'First question', 2)

  // The server rebuilds the history, so the model sees the earlier turn.
  await send(page, 'Second question')
  await expectReply(page, 'Second question', 4)

  await reopen(page, 'First question')
  await expect(chat(page).getByText('Second question', { exact: true })).toBeVisible()
  await expect(chat(page).getByText('Reply to "Second question" after 4 items.')).toBeVisible()
})

test('regenerating and editing keep earlier branches', async ({ page }) => {
  await signUp(page)
  await send(page, 'Original')
  await expectReply(page, 'Original', 2)

  await chat(page).getByText('Reply to "Original"').hover()
  await page.getByRole('button', { name: 'Regenerate' }).click()
  await expect(chat(page)).toContainText('2/2')
  await expect(page.getByRole('button', { name: 'Stop generating' })).toBeHidden()

  // The first reply is still there, and still there after a reload.
  await reopen(page, 'Original')
  await expect(chat(page)).toContainText('2/2')
  await page.getByRole('button', { name: 'Previous' }).click()
  await expect(chat(page)).toContainText('1/2')

  // Editing the question starts a new branch; the model sees only that branch.
  await chat(page).getByText('Original', { exact: true }).hover()
  await page.getByRole('button', { name: 'Edit' }).click()
  await chat(page).getByRole('textbox').first().fill('Edited')
  await chat(page).getByRole('button', { name: 'Send' }).click()
  await expectReply(page, 'Edited', 2)

  await reopen(page, 'Original')
  await expect(chat(page).getByText('Edited', { exact: true })).toBeVisible()
  await expect(chat(page)).toContainText('2/2')
})

test('stopping a reply keeps the partial response and the next turn follows it', async ({
  page,
}) => {
  await signUp(page)
  await send(page, 'SLOW please')
  await expect(chat(page).getByText(/two/)).toBeVisible()
  await page.getByRole('button', { name: 'Stop generating' }).click()
  await expect(page.getByRole('button', { name: 'Stop generating' })).toBeHidden()

  await send(page, 'After stop')
  await expectReply(page, 'After stop', 4)

  await reopen(page, 'SLOW please')
  await expect(chat(page).getByText(/Reply to "SLOW please".*two/)).toBeVisible()
  await expect(chat(page).getByText(/ten/)).toBeHidden()
  await expect(chat(page).getByText('Reply to "After stop" after 4 items.')).toBeVisible()
})

test('signing out returns to the sign-in page', async ({ page }) => {
  await signUp(page)

  await page.getByRole('button', { name: 'Account: E2E Tester' }).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()

  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
})
