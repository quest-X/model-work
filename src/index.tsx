import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.scss';
import App from './App';
import configureStore from './configureStore';
import { Provider } from 'react-redux';
import { AppInitializer } from './logic/initializer/AppInitializer';
import { registerEngineStore } from './utils/DefaultBackendUrl';
import {AuthPreview} from './views/AuthPreview/AuthPreview';

export const store = configureStore();
registerEngineStore(store);
AppInitializer.inti();

const root = ReactDOM.createRoot(document.getElementById('root') || document.createElement('div'));
root.render(
    <React.StrictMode>
        <Provider store={store}>
            <AuthPreview>
                <App />
            </AuthPreview>
        </Provider>
    </React.StrictMode>
);
