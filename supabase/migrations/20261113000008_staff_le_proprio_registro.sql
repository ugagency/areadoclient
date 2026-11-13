-- Correção: a equipe precisa saber que é equipe ANTES de verificar o MFA.
-- A política staff_select exige aal2 (app.is_staff). Sem MFA verificado, a própria linha
-- ficava invisível, o app tratava o usuário como cliente sem organização e nunca
-- mostrava o passo de cadastro do autenticador. Cada usuário lê apenas a sua linha;
-- a leitura das demais e toda escrita continuam exigindo aal2.
create policy staff_select_proprio on public.staff for select to authenticated
  using (user_id = auth.uid());
