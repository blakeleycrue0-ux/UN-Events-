// Development-only browser fixture. Never use this key for a deployed service.
import {startSignaling} from '../server/signaling.mjs';
startSignaling({development:true,port:8787,accessToken:'local-test-key-not-for-deployment-1234567890',origins:['http://127.0.0.1:8001']});
