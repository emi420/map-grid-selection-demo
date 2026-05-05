import React from 'react';
import ReactDOM from 'react-dom/client';
import Map from './map';  // adjust path to your map component
import './app.css';       // import global styles (if any)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Map />
  </React.StrictMode>
);