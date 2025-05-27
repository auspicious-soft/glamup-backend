import * as React from "react";

import { Html, Button, Head, Container, Img } from "@react-email/components";
interface EmailProps {
  otp: string;
  language: string;
}
const ForgotPasswordEmail = (props: Readonly<EmailProps>): React.ReactElement => {
  const { otp, language } = props;
  const translations: { [key: string]: { subject: string; body: string; footer: string } } = {
    en: {
      subject: "Reset Password",
      body: `Below is the otp for resetting the password.`,
      footer: `If you did not request the reset password, please ignore this email.`,
    },
    kaz: {
      subject: "Құпия сөзді қалпына келтіру",
      body: ` Төменде құпия сөзді қалпына келтіруге арналған OTP берілген.`,
      footer: `Егер сіз құпия сөзді қалпына келтіруді сұрамасаңыз, бұл хатты елемеңіз.`,
    },
    rus: {
      subject: "Сброс пароля",
      body: `Ниже приведен OTP для сброса пароля.`,
      footer: `Если вы не запрашивали сброс пароля, просто проигнорируйте это письмо.`,
    },
  };
  const { subject, body, footer } = translations[language] || translations.eng;

  return (
    <Html lang="en">
      <Head>
        <title> Glamup Reset Password</title>
      </Head>
      <Container>
        <h1 style={{ color: "black" }}>{subject}</h1>
        <p style={{ color: "black" }}>{body}</p> - <b style={{ color: "black" }}>{otp}</b>
        <p style={{ color: "#6c757d" }}>{footer}</p>
      </Container>
    </Html>
  );
};
export default ForgotPasswordEmail;
