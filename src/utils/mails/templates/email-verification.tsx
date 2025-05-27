import * as React from 'react';

import { Html, Button, Head, Container, Img } from "@react-email/components";
interface EmailProps {
  otp: string;
  language:string
}
const VerifyEmail = (props: Readonly<EmailProps>): React.ReactElement => {
  const { otp, language } = props;

  const translations: {
    [key: string]: { subject: string; body: string; footer: string };
  } = {
    eng: {
      subject: 'Verify your email',
      body: 'Below is the otp for verify your email.',
      footer: 'If you did not request the email verification, please ignore this email.',
    },
    kaz: {
      subject: 'Электрондық поштаңызды растаңыз',
      body: 'Төменде электрондық поштаңызды растау үшін OTP берілген.',
      footer: 'Егер сіз электрондық поштаны растауды сұрамасаңыз, бұл хатты елемеңіз.',
    },
    rus: {
      subject: 'Подтвердите свою электронную почту',
      body: 'Ниже приведен OTP для подтверждения вашей электронной почты.',
      footer: 'Если вы не запрашивали подтверждение электронной почты, просто проигнорируйте это письмо.',
    },
  };

  const { subject, body, footer } = translations[language] || translations.eng;

  return (
    <Html lang="en">
      <Head>
        <title>Bookstagram Verify Email</title>
      </Head>
      <Container>
        <h1 style={{ color: "black" }}>{subject}</h1>
        <p style={{ color: "black" }}>{body}</p> - <b style={{ color: "black" }}>{otp}</b>
        <p style={{ color: "#6c757d" }}>{footer}</p>
      </Container>
    </Html>
  );
};

export default VerifyEmail;