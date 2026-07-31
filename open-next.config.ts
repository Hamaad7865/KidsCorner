import { defineCloudflareConfig } from "@opennextjs/cloudflare"

/**
 * OpenNext adapter config for Cloudflare Workers.
 *
 * Deliberately bare. The usual reason to configure this is the incremental
 * cache — R2 or KV for ISR pages — and this app has none to cache: every
 * segment is `force-dynamic`, because every back-office page depends on who is
 * asking and every till page on the state of the drawer. Adding a cache
 * binding here would buy nothing and give one more thing to get wrong.
 */
export default defineCloudflareConfig()
