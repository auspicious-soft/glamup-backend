import * as React from 'react';
import { Html, Head, Container, Text } from "@react-email/components";

interface EmailProps {
  email: string;
  password: string;
}

const LoginCredentials = ({ email, password }: EmailProps): React.ReactElement => {
  return (
    <Html lang="en">
      <Head>
        <title>Bookstagram - Your Login Credentials</title>
      </Head>
      <Container style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
        <h1 style={{ color: "#000" }}>Your Login Credentials</h1>
        <Text style={{ color: "#000" }}>Here are your login credentials:</Text>
        <Text style={{ fontSize: '16px', fontWeight: 'bold', color: "#000" }}>Email: {email}</Text>
        <Text style={{ fontSize: '16px', fontWeight: 'bold', color: "#000" }}>Password: {password}</Text>
        <Text style={{ color: "#6c757d" }}>
          Please change your password after logging in for security purposes.
        </Text>
      </Container>
    </Html>
  );
};

export default LoginCredentials;