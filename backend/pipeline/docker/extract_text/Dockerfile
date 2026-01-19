FROM public.ecr.aws/lambda/python:3.11

ARG LIBREOFFICE_VERSION=25.8.4
ARG LIBREOFFICE_TARBALL=LibreOffice_${LIBREOFFICE_VERSION}_Linux_x86-64_rpm.tar.gz
ARG LIBREOFFICE_URL=https://download.documentfoundation.org/libreoffice/stable/${LIBREOFFICE_VERSION}/rpm/x86_64/${LIBREOFFICE_TARBALL}

RUN yum install -y curl tar gzip && \
    curl -L "${LIBREOFFICE_URL}" -o "/tmp/${LIBREOFFICE_TARBALL}" && \
    tar -xzf "/tmp/${LIBREOFFICE_TARBALL}" -C /tmp && \
    yum install -y /tmp/LibreOffice_${LIBREOFFICE_VERSION}*/RPMS/*.rpm && \
    ln -s /opt/libreoffice*/program/soffice /usr/local/bin/soffice && \
    rm -rf /tmp/LibreOffice_${LIBREOFFICE_VERSION}* "/tmp/${LIBREOFFICE_TARBALL}" && \
    yum clean all

COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt -t /var/task

COPY . /var/task

CMD ["extract_text.handler"]
