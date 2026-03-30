import React from 'react'
import ReactDOM from 'react-dom/client'

// The full app UI is in public/index.html (standalone version).
// Wire API calls using src/api.js for full backend integration.
// See DEPLOY.md Step 6 for migration instructions.

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <div style={{fontFamily:'sans-serif',padding:'2rem'}}>
      <h2>BAM App is loading…</h2>
      <p>Open <code>public/index.html</code> for the standalone UI, or wire up <code>src/api.js</code> to build the full React version.</p>
    </div>
  </React.StrictMode>
)
