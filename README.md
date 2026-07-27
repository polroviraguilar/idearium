# Idearium

Idearium is a personal Progressive Web App for capturing, organizing, and developing ideas through text, voice notes, tags, categories, attachments, and automatic transcription.

The application combines an offline-first local database with secure cloud synchronization, allowing users to continue working even when the connection is unstable and recover their data across devices.

Production application: https://idearium.pages.dev

Repository: https://github.com/polroviraguilar/idearium

## Overview

Idearium is designed as a private idea-management workspace. It focuses on fast capture first and organization later.

Users can create text notes, record voice memos, transcribe audio, attach files, organize ideas by category and tags, and synchronize everything between devices.

The application is implemented as a PWA and can be installed on supported desktop and mobile browsers.

## Main Features

### Authentication

- User registration and sign-in with Supabase Auth
- Isolated data for every authenticated user
- Secure session handling
- Sign-out support
- Row Level Security policies for all remote data

### Notes

- Create, edit, archive, restore, pin, and delete notes
- Automatic local saving
- Search by title, content, and tags
- Sort notes by latest update
- Dedicated states for active, pending-review, and archived notes

### Categories and Tags

- Default categories for inbox, pending review, ideas, projects, references, and archive
- User-created categories
- Category-specific colors and ordering
- Multiple tags per note
- Category and tag synchronization across devices

### Voice Notes

- Record audio directly from the browser
- Preview recordings before saving
- Select Catalan, Spanish, English, or automatic language detection
- Add optional transcription context
- Preserve the original recording even when transcription fails
- Retry failed transcriptions
- Automatic recovery for interrupted transcription states

### Automatic Transcription

- Production transcription through Cloudflare Pages Functions and Workers AI
- Local development transcription through an Express server and OpenAI
- Authenticated transcription requests
- Protection against duplicate requests
- Request timeout and cancellation support
- Maximum recording duration and upload-size validation
- Safe error handling without exposing internal service details

### Attachments

- Images
- Audio files
- Video files
- Documents
- Web links

Binary files are stored in a private Supabase Storage bucket. Metadata is synchronized through the Supabase database, while local copies are cached in IndexedDB for offline access.

### Synchronization

- Local-first storage with Dexie and IndexedDB
- Cloud synchronization with Supabase
- Synchronization of notes, categories, tags, attachments, and deletions
- Pending-change queue while offline
- Automatic retry when the connection returns
- Periodic background synchronization while the application is open
- Conflict-copy creation when local and remote note changes overlap

### Offline Support

- PWA installation
- Cached application shell
- Local access to previously downloaded notes and attachments
- Local editing without an active connection
- Automatic synchronization after reconnecting

### Backup and Restore

- Export all user data to a JSON backup
- Include notes, categories, metadata, and attachment contents
- Restore a backup into the local user database
- Synchronize restored data without creating duplicate remote records

### Appearance and Responsive Design

- Light and dark themes
- Desktop, tablet, and mobile layouts
- Installable PWA interface
- Accessible keyboard focus states
- Responsive note editor and attachment views

## Technology Stack

### Frontend

- React 18
- TypeScript
- Vite
- Dexie
- IndexedDB
- vite-plugin-pwa
- Lucide React

### Backend and Cloud Services

- Supabase Auth
- Supabase PostgreSQL
- Supabase Row Level Security
- Supabase Storage
- Cloudflare Pages
- Cloudflare Pages Functions
- Cloudflare Workers AI

### Local Development API

- Node.js
- Express
- Multer
- OpenAI API

## Architecture

```text
Browser / Installed PWA
├── React interface
├── Dexie / IndexedDB
├── Service worker
└── Supabase client
    ├── Authentication
    ├── PostgreSQL data
    └── Private Storage

Production transcription
└── Cloudflare Pages Function
    ├── Supabase session validation
    └── Workers AI transcription

Local transcription
└── Express development server
    └── OpenAI transcription API
```

## Data Model

The main entities are:

- `categories`
- `notes`
- `attachments`

Each synchronized record includes user ownership and synchronization metadata. Local data is stored in a user-specific IndexedDB database:

```text
idearium-user-<user-id>
```

Remote access is restricted by Supabase Row Level Security so authenticated users can only access their own records.

## Storage

The private Supabase Storage bucket is:

```text
idearium-attachments
```

Files follow this path structure:

```text
<user-id>/<note-id>/<attachment-id>
```

Links are stored as metadata only and do not create Storage objects.

## Local Development

### Requirements

- Node.js 22 or later
- npm
- A Supabase project
- An OpenAI API key for local transcription

### Installation

```bash
git clone https://github.com/polroviraguilar/idearium.git
cd idearium
npm install
```

### Environment Variables

Create a `.env.local` file in the project root:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

Create a `.env` file for the local Express transcription server:

```env
OPENAI_API_KEY=your-openai-api-key
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-transcribe
PORT=8787
```

Do not commit `.env`, `.env.local`, secret keys, or service-role keys.

### Start Development

```bash
npm run dev
```

This starts:

- Vite on `http://localhost:5173`
- The local Express API on `http://localhost:8787`

Vite proxies `/api` requests to the Express server during development.

### Production Build

```bash
npm run build
```

### Preview the Build

```bash
npm run preview
```

## Available Scripts

```text
npm run dev      Start the Vite frontend and local Express API
npm run build    Run TypeScript checks and create the production build
npm run start    Start the Express server in production mode
npm run preview  Preview the Vite production build locally
```

## Cloudflare Deployment

The production frontend is deployed with Cloudflare Pages.

The GitHub repository is connected to Cloudflare, so a push to the main branch triggers a new deployment.

Production URL:

```text
https://idearium.pages.dev
```

The Pages project requires:

### Workers AI Binding

```text
AI
```

### Environment Variables

```text
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
```

The production transcription endpoint is:

```text
POST /api/transcribe
```

GitHub Pages is not used because the application requires a server-side Pages Function and a Workers AI binding.

## Supabase Security

The project uses:

- Row Level Security on all application tables
- User-scoped read, insert, update, and delete policies
- A private Storage bucket
- Storage paths prefixed by the authenticated user ID
- Authenticated access to the transcription endpoint
- No service-role key in the browser

The Supabase publishable key can be used by the frontend because access is restricted by authentication and Row Level Security. Secret and service-role keys must never be exposed in client code.

## PWA Behavior

Idearium uses an automatically updated service worker.

The PWA configuration includes:

- Installable application manifest
- Application icons
- Cached application resources
- Cached image resources
- API routes excluded from navigation fallback
- Automatic service-worker updates

## Backup Format

Backups are exported as JSON and include:

- Notes
- Categories
- Attachments
- Synchronization metadata
- Binary attachments encoded as data URLs

A backup restore replaces the current local user data and then synchronizes it with the remote database.

## Project Status

The core application is complete and deployed.

Implemented areas include:

- Authentication
- Local database
- Secure remote database
- Notes and categories
- Tags and search
- Attachment synchronization
- Voice recording
- Automatic transcription
- Offline change queue
- Backup and restore
- Legacy IndexedDB migration
- Production deployment

Final validation focuses on extended offline testing and testing the installed PWA on additional mobile devices.

## Current Limitations

The current version does not include:

- Real-time collaborative editing
- Public note sharing
- Rich-text editing
- Reminders or calendar integration
- Automatic AI classification
- Long-audio chunked transcription
- Shared workspaces

These features may be considered for future versions.

## Repository About Configuration

Recommended GitHub repository details:

```text
Description:
Personal PWA for capturing, organizing, and developing ideas with voice transcription, attachments, offline support, and cross-device synchronization.

Website:
https://idearium.pages.dev

Topics:
react
typescript
vite
pwa
supabase
cloudflare
indexeddb
dexie
offline-first
voice-notes
speech-to-text
workers-ai
```

Recommended home page options:

```text
Releases: enabled when versioned releases are published
Deployments: enabled
Packages: disabled unless the project starts publishing packages
```

## License

No license has been defined yet.

Before allowing reuse, redistribution, or contributions, add a license file that reflects the intended terms for the project.
