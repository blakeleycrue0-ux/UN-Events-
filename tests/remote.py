from pin_helpers import unlock_app, confirm_action
"""Real WebRTC over local authenticated signaling; not a cross-network/TURN test."""
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--allow-loopback-in-peer-connection','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'])
 source=b.new_context(permissions=['camera']);watcher=b.new_context()
 camera=source.new_page();viewer=watcher.new_page();errors=[]
 for page in [camera,viewer]:page.on('pageerror',lambda e:errors.append(str(e)))
 camera.goto('http://127.0.0.1:8001/camara.html');unlock_app(camera);assert camera.locator('#landingPage').is_visible()
 assert not camera.evaluate('!!state.stream')
 camera.screenshot(path='/workspace/security-setup/glass-home.png',full_page=True)
 camera.click('#openCamera');camera.locator('.extra-tools').evaluate('d=>d.open=true');camera.click('#camera');camera.wait_for_function('!!state.stream && video.videoWidth>0')
 camera.locator('.settings').evaluate('d=>d.open=true');camera.select_option('#clip','10');camera.click('#record');camera.wait_for_function('state.recording')
 camera.goto('http://127.0.0.1:8001/camara.html#remote');unlock_app(camera);camera.select_option('#remoteProvider','server');camera.select_option('#remoteRole','camera');camera.fill('#signalUrl','ws://127.0.0.1:8787');camera.fill('#hostAccess','local-test-key-not-for-deployment-1234567890');camera.click('#connectRemote');confirm_action(camera);camera.wait_for_selector('#pairingResult:visible');key=camera.locator('#createdPair').input_value();assert len(key)==48
 viewer.goto('http://127.0.0.1:8001/camara.html');unlock_app(viewer);viewer.click('#openViewer');viewer.select_option('#remoteProvider','server');viewer.fill('#signalUrl','ws://127.0.0.1:8787');viewer.fill('#pairKey',key);viewer.click('#connectRemote')
 viewer.wait_for_function("document.getElementById('remoteVideo').videoWidth>0 && remotePeer.connectionState==='connected'",timeout=40000)
 assert not viewer.evaluate('!!state.stream')
 before=viewer.locator('#remoteVideo').evaluate('v=>v.getVideoPlaybackQuality().totalVideoFrames');viewer.wait_for_timeout(1200);after=viewer.locator('#remoteVideo').evaluate('v=>v.getVideoPlaybackQuality().totalVideoFrames');assert after>before
 camera.wait_for_function("events.some(e=>e.type==='grabación'&&e.message.includes('guardada'))",timeout=20000)
 print('PASS real video between independent browser contexts; viewer requests no camera; source records local clip concurrently')
 camera.click('#disconnectRemote');viewer.wait_for_function('remotePeer===null');assert camera.evaluate('!!state.stream')
 print('PASS disconnect revokes the remote session and keeps local camera running')
 assert not errors,errors
 b.close()
