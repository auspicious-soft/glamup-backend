export const config = {
    jwt: {
        secret: process.env.JWT_SECRET || 'your-jwt-secret',
        expiresIn: '1d'
    },
    facebook: {
        clientId: process.env.FACEBOOK_APP_ID!,
        clientSecret: process.env.FACEBOOK_APP_SECRET!,
        callbackURL: '/auth/facebook/callback'
    },
    google: {
        clientId: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        callbackURL: '/auth/google/callback'
    },
    apple: {
        clientId: process.env.APPLE_CLIENT_ID!,
        teamId: process.env.APPLE_TEAM_ID!,
        keyId: process.env.APPLE_KEY_ID!,
        privateKeyLocation: process.env.APPLE_PRIVATE_KEY_LOCATION!,
        callbackURL: '/auth/apple/callback'
    },
    whatsapp: {
        clientId: process.env.WHATSAPP_CLIENT_ID!,
        clientSecret: process.env.WHATSAPP_CLIENT_SECRET!,
        callbackURL: '/auth/whatsapp/callback'
    },
    app: {
        webUrl: process.env.WEB_APP_URL!,
        mobileScheme: process.env.MOBILE_APP_SCHEME!
    }
};