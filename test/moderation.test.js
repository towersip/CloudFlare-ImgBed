import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import { loadFunction, memoryDatabase } from './helpers/loadFunction.js';
import { normalizeSessionMaxAgeDays } from '../functions/utils/auth/sessionConfig.js';

describe('fork moderation compatibility', () => {
    const imageUrl = 'https://huggingface.invalid/photo.png';
    const config = {
        enabled: true,
        channel: 'sightengine',
        sightengineApiUser: 'test-user',
        sightengineApiSecret: 'test-secret',
        nsfwApiPath: 'https://nsfw.invalid/check?model=test',
    };

    function loadModeration(fetch) {
        return loadFunction('functions/upload/uploadTools.js', {
            fetchSecurityConfig: async () => ({ upload: { moderate: config } }),
        }, { fetch, console: { error() {}, warn() {} } });
    }

    it('preserves Sightengine and fallback settings through the security settings API', async () => {
        const db = memoryDatabase();
        const security = await loadFunction('functions/api/manage/sysConfig/security.js', {
            getDatabase: () => db,
            normalizeSessionMaxAgeDays,
        });
        const settings = await security.getSecurityConfig(db, {});
        settings.upload.moderate = { ...settings.upload.moderate, ...config, sightengineModels: 'nudity-2.1,weapon' };
        const response = await security.onRequest({
            env: {},
            request: new Request('https://test/api/manage/sysConfig/security', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ upload: settings.upload }),
            }),
        });
        assert.equal(response.status, 200);
        const loaded = await security.onRequest({
            env: {}, request: new Request('https://test/api/manage/sysConfig/security'),
        });
        assert.deepEqual((await loaded.json()).upload.moderate, settings.upload.moderate);
    });

    it('keeps explicit and suggestive scores in their separate rating bands', async () => {
        const { classifySightengineLabel } = await loadModeration(() => assert.fail('unexpected request'));
        for (const [nudity, expected] of [
            [{ sexual_activity: 0.7 }, 'adult'],
            [{ sexual_display: 0.4 }, 'teen'],
            [{ very_suggestive: 0.99 }, 'teen'],
            [{ sexual_activity: 0.1, suggestive: 0.1 }, 'everyone'],
        ]) {
            assert.equal(classifySightengineLabel({ nudity }), expected);
        }
    });

    it('sends original media directly to Sightengine without requiring a public URL', async () => {
        const media = new File(['original-image'], 'photo.png', { type: 'image/png' });
        const tools = await loadModeration(async (url, options) => {
            assert.equal(url, 'https://api.sightengine.com/1.0/check.json');
            assert.equal(options.method, 'POST');
            assert.equal(await options.body.get('media').text(), 'original-image');
            assert.equal(options.body.get('media').name, 'photo.png');
            assert.equal(options.body.get('api_user'), config.sightengineApiUser);
            assert.equal(options.body.get('api_secret'), config.sightengineApiSecret);
            assert.equal(options.body.get('models'), 'nudity-2.1');
            assert.equal(options.body.has('url'), false);
            return Response.json({ status: 'success', nudity: { sexual_activity: 0.8 } });
        });
        assert.equal(await tools.moderateContent({}, imageUrl, media), 'adult');
    });

    for (const status of [200, 429]) {
        it(`falls back to NSFWJS on Sightengine usage_limit with HTTP ${status}`, async () => {
            let calls = 0;
            const tools = await loadModeration(async url => {
                calls++;
                const parsed = new URL(url);
                if (calls === 1) {
                    assert.equal(parsed.hostname, 'api.sightengine.com');
                    assert.equal(parsed.searchParams.get('url'), imageUrl);
                    return Response.json({ status: 'failure', error: { type: 'usage_limit' } }, { status });
                }
                assert.equal(parsed.hostname, 'nsfw.invalid');
                assert.equal(parsed.searchParams.get('model'), 'test');
                assert.equal(parsed.searchParams.get('url'), imageUrl);
                return Response.json({ score: 0.8 });
            });
            assert.equal(await tools.moderateContent({}, imageUrl), 'adult');
            assert.equal(calls, 2);
        });
    }

    it('retains the unreviewed label for other service failures without triggering quota fallback', async () => {
        let calls = 0;
        const tools = await loadModeration(async () => {
            calls++;
            return Response.json({ error: { type: 'invalid_credentials' } }, { status: 401 });
        });
        assert.equal(await tools.moderateContent({}, imageUrl), 'None');
        assert.equal(calls, 1);
    });
});
